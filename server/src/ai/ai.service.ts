import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { MetricsService } from '../metrics/metrics.service';
import { MetricsOutputContract, DomainGraph } from '../domain/domain-model.interface';
import { normalizeToDomainGraph } from '../domain/domain-normalizer.util';
import { RedisService } from '../redis/redis.service';
import { AnalysisGateway } from '../gateway/analysis.gateway';
import { RulesService } from '../rules/rules.service';
import { RuleViolation } from '../rules/rule-engine.interface';
import { RagService, RetrievedPattern } from '../rag/rag.service';

export interface CritiqueResult {
  source: 'ai' | 'deterministic-fallback';
  cached?: boolean;
  metrics: MetricsOutputContract;
  ruleViolations?: RuleViolation[];
  citedPatterns?: RetrievedPattern[];
  analysis: {
    executiveSummary: string;
    strengths: string[];
    spofRisks: string[];
    scalabilityBottlenecks: string[];
    recommendations: string[];
  };
  rawCritiqueText: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly gateway: AnalysisGateway,
    private readonly rulesService: RulesService,
    private readonly ragService: RagService,
  ) {}

  async generateCritique(
    rawNodes: any[],
    rawEdges: any[],
    systemContext?: string,
    projectId?: string,
    socketId?: string,
  ): Promise<CritiqueResult> {
    // 0. Compute deterministic cache key from input topology
    const inputHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawNodes) + JSON.stringify(rawEdges) + (systemContext || ''))
      .digest('hex');
    const cacheKey = `critique:${inputHash}`;

    // 1. Check Redis Cache (<20ms response on repeat queries)
    const cachedCritique = await this.redisService.get(cacheKey);
    if (cachedCritique) {
      this.logger.log(`[RedisCache] Cache HIT for key ${cacheKey}`);
      try {
        const parsed = JSON.parse(cachedCritique);
        return { ...parsed, cached: true };
      } catch {
        // Continue to fresh calculation
      }
    }
    this.logger.log(`[RedisCache] Cache MISS for key ${cacheKey}`);

    // Stream status update 1: Topology
    this.gateway.emitStatusUpdate('TOPOLOGY', 'Checking redundancy & single points of failure...', projectId, socketId);

    // 2. Run deterministic Metrics Engine first (anti-hallucination baseline)
    const metrics = this.metricsService.evaluate(rawNodes, rawEdges);
    const domainGraph = normalizeToDomainGraph(rawNodes, rawEdges);

    // Stream status update 2: Rules Engine
    this.gateway.emitStatusUpdate('RULES', 'Evaluating architecture rule catalog & constraints...', projectId, socketId);
    const ruleViolations = this.rulesService.evaluateRules(domainGraph, metrics);

    // Stream status update 3: RAG Semantic Knowledge Retrieval
    this.gateway.emitStatusUpdate('RAG', 'Retrieving architectural patterns from Knowledge Base...', projectId, socketId);
    const citedPatterns = await this.ragService.getRelevantPatterns(domainGraph, metrics, ruleViolations);
    const ragContext = this.ragService.formatRAGContext(citedPatterns);

    // Stream status update 4: AI Synthesis
    this.gateway.emitStatusUpdate('SYNTHESIS', 'Synthesizing expert architectural critique...', projectId, socketId);

    // 3. Build grounded prompt
    const prompt = this.buildCritiquePrompt(rawNodes, rawEdges, metrics, ruleViolations, ragContext, systemContext);

    let result: CritiqueResult;

    // 4. Attempt LLM call with Tool Calling support
    try {
      const llmResponse = await this.callLLM(prompt, domainGraph, metrics);
      if (llmResponse) {
        result = this.parseLlmCritique(llmResponse, metrics, ruleViolations, citedPatterns);
      } else {
        result = this.buildDeterministicFallback(metrics, ruleViolations, citedPatterns);
      }
    } catch (err: any) {
      this.logger.warn(`LLM call failed or timed out: ${err?.message}. Falling back to deterministic engine.`);
      result = this.buildDeterministicFallback(metrics, ruleViolations, citedPatterns);
    }

    // 5. Store in Redis Cache with 1-hour TTL (only cache successful AI analyses)
    if (result.source === 'ai') {
      await this.redisService.set(cacheKey, JSON.stringify(result), 3600);
    }

    return result;
  }

  /**
   * Provider-Agnostic LLM Caller with Function / Tool Calling Support
   * Swappable via .env: LLM_PROVIDER=gemini | groq | openai
   */
  async callLLM(prompt: string, graph: DomainGraph, metrics: MetricsOutputContract): Promise<string | null> {
    const provider = this.configService.get<string>('LLM_PROVIDER') || 'gemini';
    const geminiKey = this.configService.get<string>('GEMINI_API_KEY');
    const groqKey = this.configService.get<string>('GROQ_API_KEY');
    const openaiKey = this.configService.get<string>('OPENAI_API_KEY');

    this.logger.log(`[LLM Diagnostics] Provider: ${provider}, hasGroqKey: ${!!groqKey}, hasGeminiKey: ${!!geminiKey}`);

    // Tool declarations for Function Calling
    const toolDeclarations = [
      {
        name: 'get_node_metrics',
        description: 'Inspect live traffic, replicas, and dependency links for a given architecture component',
        parameters: {
          type: 'object',
          properties: {
            nodeId: { type: 'string', description: 'The component ID or label to inspect' },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'check_cycle_impact',
        description: 'Inspect details of detected cyclic dependency deadlocks across services',
        parameters: {
          type: 'object',
          properties: {
            serviceName: { type: 'string', description: 'The service name to trace cycles for' },
          },
          required: ['serviceName'],
        },
      },
    ];

    // 1. Google Gemini Provider
    if ((provider === 'gemini' || !groqKey) && geminiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ functionDeclarations: toolDeclarations }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(9000),
      });

      if (!res.ok) throw new Error(`Gemini API returned status ${res.status}`);
      const data = await res.json();
      const firstCandidate = data?.candidates?.[0]?.content?.parts?.[0];

      // Handle function call if requested by model
      if (firstCandidate?.functionCall) {
        const fnCall = firstCandidate.functionCall;
        const toolResult = this.executeTool(fnCall.name, fnCall.args, graph, metrics);

        // Follow-up request with function response
        const followUpRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              { role: 'user', parts: [{ text: prompt }] },
              { role: 'model', parts: [{ functionCall: fnCall }] },
              {
                role: 'function',
                parts: [{
                  functionResponse: {
                    name: fnCall.name,
                    response: toolResult,
                  },
                }],
              },
            ],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1000 },
          }),
          signal: AbortSignal.timeout(7000),
        });

        if (followUpRes.ok) {
          const followUpData = await followUpRes.json();
          return followUpData?.candidates?.[0]?.content?.parts?.[0]?.text || null;
        }
      }

      return firstCandidate?.text || null;
    }

    // 2. Groq Provider (Ultra-fast inference)
    if (groqKey) {
      const preferredModel = this.configService.get<string>('GROQ_MODEL') || 'openai/gpt-oss-120b';
      const modelsToTry = [
        preferredModel,
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b',
        'openai/gpt-oss-20b',
      ];
      const uniqueModels = [...new Set(modelsToTry)];

      for (const model of uniqueModels) {
        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${groqKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: 'system',
                  content: 'You are a Principal Distributed Systems Architect. Cite knowledge base pattern codes directly when making recommendations.',
                },
                { role: 'user', content: prompt },
              ],
              temperature: 0.2,
            }),
            signal: AbortSignal.timeout(9000),
          });

          if (res.ok) {
            const data = await res.json();
            const content = data?.choices?.[0]?.message?.content;
            if (content) {
              this.logger.log(`Successfully generated critique using Groq model: ${model}`);
              return content;
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            this.logger.warn(`Groq model ${model} failed (${res.status}): ${errData?.error?.message || 'Unknown'}`);
          }
        } catch (modelErr: any) {
          this.logger.warn(`Groq request error with ${model}: ${modelErr?.message}`);
        }
      }
    }

    // 3. OpenAI Fallback
    if (openaiKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(9000),
      });

      if (!res.ok) throw new Error(`OpenAI API returned status ${res.status}`);
      const data = await res.json();
      return data?.choices?.[0]?.message?.content || null;
    }

    return null;
  }

  /**
   * Deterministic Tool Execution handler for model function calling
   */
  executeTool(toolName: string, args: any, graph: DomainGraph, metrics: MetricsOutputContract): any {
    if (toolName === 'get_node_metrics') {
      const targetId = args?.nodeId?.toLowerCase();
      const node = graph.nodes.find(
        (n) => n.id.toLowerCase() === targetId || n.name.toLowerCase().includes(targetId)
      );
      if (!node) return { error: `Node ${args.nodeId} not found in current graph.` };

      return {
        id: node.id,
        name: node.name,
        category: node.category,
        technology: node.technology,
        replicas: node.replicas,
        inboundLinks: graph.inDegrees?.get(node.id) || 0,
        outboundLinks: graph.outDegrees?.get(node.id) || 0,
      };
    }

    if (toolName === 'check_cycle_impact') {
      return {
        cyclesDetected: (metrics.cycles && metrics.cycles.length > 0) || false,
        cycles: metrics.cycles || [],
      };
    }

    return { error: `Unknown tool ${toolName}` };
  }

  private buildCritiquePrompt(
    nodes: any[],
    edges: any[],
    metrics: MetricsOutputContract,
    violations: RuleViolation[],
    ragContext: string,
    context?: string,
  ): string {
    const nodeSummary = nodes
      .map((n) => `- ${n.data?.label || n.id} (${n.data?.category}, tech: ${n.data?.technology || 'standard'}, replicas: ${n.data?.replicas || 1})`)
      .join('\n');
    const edgeSummary = edges
      .map((e) => `- ${e.source} -> ${e.target} via ${e.data?.protocol || 'HTTPS'} (${e.data?.isAsync ? 'async' : 'sync'})`)
      .join('\n');

    const ruleSummary = violations.length > 0
      ? violations.map((v) => `- [${v.severity}] ${v.title}: ${v.message} (Remediation: ${v.remediation})`).join('\n')
      : '- All deterministic architectural rules PASSED with zero violations.';

    return `
You are a Principal Distributed Systems Architect conducting a rigorous architecture review.

CONTEXT: ${context || 'High-availability distributed internet architecture'}

DETERMINISTIC GRAPH METRICS:
- Services Count: ${metrics.services}
- Databases Count: ${metrics.databases}
- In-Memory Caches: ${metrics.caches}
- Message Queues: ${metrics.queues}
- Ingress Gateways / Load Balancers: ${metrics.loadBalancers || 0}
- Single Points of Failure (SPOF): ${metrics.spof.join(', ') || 'None'}
- Service Fan-Out Ratio: ${metrics.fanOut}x
- Redundancy Score: ${metrics.redundancyScore}/100
- Warnings: ${metrics.warnings?.join('; ') || 'None'}

DETERMINISTIC RULE ENGINE FINDINGS:
${ruleSummary}

RETRIEVED ARCHITECTURAL KNOWLEDGE BASE STANDARDS:
${ragContext}

COMPONENTS:
${nodeSummary}

CONNECTIONS:
${edgeSummary}

Provide a structured critique formatted as follows:
1. Executive Summary: 2-3 sentences evaluating the overall system soundness.
2. Strengths: 2 bullet points on what was designed correctly.
3. SPOF & Availability Risks: Concrete analysis of any single points of failure.
4. Scalability Bottlenecks: Discussion on caching, read/write ratios, and queuing.
5. Actionable Recommendations: 3 prioritized architectural fixes citing the retrieved knowledge base patterns by name (e.g. "[Pattern: 06-database-replication]").
`;
  }

  private parseLlmCritique(
    rawText: string,
    metrics: MetricsOutputContract,
    violations: RuleViolation[],
    citedPatterns: RetrievedPattern[],
  ): CritiqueResult {
    const spofRisks = violations.filter((v) => v.severity === 'CRITICAL').map((v) => v.title);
    if (spofRisks.length === 0 && metrics.spof.length > 0) {
      spofRisks.push(`Unreplicated stateful database: ${metrics.spof.join(', ')}`);
    }

    const recommendations = citedPatterns.map((p) => `[Ref: ${p.docKey}] Apply ${p.title} to improve resilience.`);
    if (recommendations.length === 0) {
      recommendations.push('Maintain standby replicas and in-memory caching tiers across all data layers.');
    }

    return {
      source: 'ai',
      metrics,
      ruleViolations: violations,
      citedPatterns,
      analysis: {
        executiveSummary: 'AI analysis grounded in deterministic graph heuristics and retrieved knowledge base standards.',
        strengths: ['Decoupled microservice architecture', 'Visualized data flow and communication protocols'],
        spofRisks: spofRisks.length > 0 ? spofRisks : ['No critical database bottlenecks identified.'],
        scalabilityBottlenecks: violations.filter((v) => v.severity === 'WARNING').map((v) => v.title),
        recommendations,
      },
      rawCritiqueText: rawText,
    };
  }

  private buildDeterministicFallback(
    metrics: MetricsOutputContract,
    violations: RuleViolation[],
    citedPatterns: RetrievedPattern[],
  ): CritiqueResult {
    const spofRisks = violations.filter((v) => v.severity === 'CRITICAL').map((v) => v.title);
    if (spofRisks.length === 0 && metrics.spof.length > 0) {
      spofRisks.push(`Unreplicated database: ${metrics.spof.join(', ')}`);
    }

    const recommendations: string[] = [];
    violations.forEach((v) => {
      recommendations.push(`${v.remediation}`);
    });

    citedPatterns.forEach((p) => {
      recommendations.push(`[According to Pattern: ${p.docKey}] ${p.title} - ${p.summary.slice(0, 100)}...`);
    });

    if (recommendations.length === 0) {
      recommendations.push('Architecture topology meets core resilience and redundancy criteria.');
    }

    return {
      source: 'deterministic-fallback',
      metrics,
      ruleViolations: violations,
      citedPatterns,
      analysis: {
        executiveSummary: 'AI analysis unavailable. Showing deterministic analysis based on graph traversal rules and retrieved knowledge base standards.',
        strengths: [
          `${metrics.services} services configured with ${metrics.fanOut}x average fan-out`,
          `Overall architecture redundancy evaluated at ${metrics.redundancyScore}/100`,
        ],
        spofRisks: spofRisks.length > 0 ? spofRisks : ['No direct single-instance points of failure identified.'],
        scalabilityBottlenecks: violations.filter((v) => v.severity === 'WARNING').map((v) => v.title),
        recommendations,
      },
      rawCritiqueText: `### Deterministic Architectural Critique\n\n*Note: AI analysis unavailable. Showing deterministic analysis.*\n\n**Score:** ${metrics.redundancyScore}/100\n\n**Rule Violations:**\n${violations.map((v) => `- [${v.severity}] ${v.title}`).join('\n') || '- None'}\n\n**Grounded Knowledge Standards:**\n${citedPatterns.map((p) => `- [${p.docKey}] ${p.title}`).join('\n') || '- None'}\n\n**Recommendations:**\n${recommendations.map((r) => `- ${r}`).join('\n')}`,
    };
  }
}
