import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../src/rag/embedding.service';
import { RagService } from '../src/rag/rag.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { RulesService } from '../src/rules/rules.service';
import { AiService } from '../src/ai/ai.service';
import { InterviewService } from '../src/ai/interview.service';
import { RedisService } from '../src/redis/redis.service';
import { AnalysisGateway } from '../src/gateway/analysis.gateway';
import { normalizeToDomainGraph } from '../src/domain/domain-normalizer.util';
import * as fs from 'fs';
import * as path from 'path';

export interface BridgeItem {
  id?: string;
  action: 'rag' | 'architecture' | 'interview_eval' | 'interview_questions' | 'ping';
  query?: string;
  limit?: number;
  nodes?: any[];
  edges?: any[];
  systemContext?: string;
  question?: string;
  idealAnswer?: string;
  keyConcepts?: string[];
  userAnswer?: string;
  count?: number;
}

interface BridgeEnvelope {
  batch?: BridgeItem[];
  item?: BridgeItem;
}

async function processSingleItem(
  item: BridgeItem,
  services: {
    ragService: RagService;
    metricsService: MetricsService;
    rulesService: RulesService;
    aiService: AiService;
    interviewService: InterviewService;
  }
) {
  const { ragService, metricsService, rulesService, aiService, interviewService } = services;
  const startTime = performance.now();
  let result: any = null;

  switch (item.action) {
    case 'ping': {
      result = { status: 'ok', timestamp: new Date().toISOString() };
      break;
    }

    case 'rag': {
      const searchResults = item.query ? await ragService.search(item.query, item.limit || 3) : [];
      let patternResults: any[] = [];
      let formattedContext = '';

      if (item.nodes && item.edges) {
        const domainGraph = normalizeToDomainGraph(item.nodes, item.edges);
        const metrics = metricsService.evaluate(item.nodes, item.edges);
        const violations = rulesService.evaluateRules(domainGraph, metrics);
        patternResults = await ragService.getRelevantPatterns(domainGraph, metrics, violations);
        formattedContext = ragService.formatRAGContext(patternResults);
      }

      result = {
        searchResults,
        patternResults,
        formattedContext,
      };
      break;
    }

    case 'architecture': {
      const rawInputNodes = item.nodes || [];
      const rawInputEdges = item.edges || [];
      const systemContext = item.systemContext || '';

      const nodes = rawInputNodes.map((n) => ({
        id: n.id,
        data: {
          label: n.data?.label || n.name || n.id,
          category: n.data?.category || n.category,
          replicas: n.data?.replicas ?? n.replicas,
          technology: n.data?.technology || n.technology,
        },
      }));

      const edges = rawInputEdges.map((e) => ({
        id: e.id,
        source: e.source || e.sourceId,
        target: e.target || e.targetId,
        data: {
          protocol: e.data?.protocol || e.protocol || 'HTTPS',
          isAsync: e.data?.isAsync ?? e.isAsync ?? false,
        },
      }));

      const domainGraph = normalizeToDomainGraph(nodes, edges);
      const metrics = metricsService.evaluate(nodes, edges);
      const violations = rulesService.evaluateRules(domainGraph, metrics);
      const patterns = await ragService.getRelevantPatterns(domainGraph, metrics, violations);
      const critique = await aiService.generateCritique(nodes, edges, systemContext);

      result = {
        metrics,
        violations,
        patterns,
        critique,
      };
      break;
    }

    case 'interview_eval': {
      const evaluation = await interviewService.evaluateInterviewAnswer(
        item.question || '',
        item.idealAnswer || '',
        item.keyConcepts || [],
        item.userAnswer || '',
      );
      result = { evaluation };
      break;
    }

    case 'interview_questions': {
      const nodes = item.nodes || [];
      const edges = item.edges || [];
      const questions = await interviewService.generateInterviewQuestions(
        nodes,
        edges,
        item.count || 5,
        item.systemContext,
      );
      result = { questions };
      break;
    }

    default:
      throw new Error(`Unsupported action: ${(item as any).action}`);
  }

  const durationMs = performance.now() - startTime;
  return {
    id: item.id,
    success: true,
    durationMs: Number(durationMs.toFixed(2)),
    data: result,
  };
}

async function runBridge() {
  const args = process.argv.slice(2);
  let inputFile: string | null = null;
  let outputFile: string | null = null;

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      inputFile = arg.replace('--input=', '');
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.replace('--output=', '');
    }
  }

  if (!inputFile) {
    console.error(JSON.stringify({ error: 'Missing --input argument' }));
    process.exit(1);
  }

  const rawInput = fs.readFileSync(path.resolve(inputFile), 'utf-8');
  const envelope: BridgeEnvelope = JSON.parse(rawInput);

  // Initialize service dependencies ONCE
  const config = new ConfigService();
  const prisma = new PrismaClient();
  const embeddingService = new EmbeddingService(config);
  const ragService = new RagService(prisma as any, embeddingService);
  const rulesService = new RulesService();
  const metricsService = new MetricsService();
  const redisService = new RedisService(config);
  const gateway = new AnalysisGateway();

  const aiService = new AiService(
    metricsService,
    config,
    redisService,
    gateway,
    rulesService,
    ragService,
  );
  const interviewService = new InterviewService();

  const services = { ragService, metricsService, rulesService, aiService, interviewService };
  const items = envelope.batch || (envelope.item ? [envelope.item] : [envelope as any]);
  const outputs: any[] = [];

  try {
    for (const it of items) {
      try {
        const itemRes = await processSingleItem(it, services);
        outputs.push(itemRes);
      } catch (err: any) {
        outputs.push({
          id: it.id,
          success: false,
          error: err?.message || String(err),
          durationMs: 0,
        });
      }
    }

    const finalEnvelope = {
      success: true,
      count: outputs.length,
      results: outputs,
    };

    if (outputFile) {
      fs.writeFileSync(path.resolve(outputFile), JSON.stringify(finalEnvelope, null, 2), 'utf-8');
    }
    console.log(JSON.stringify(finalEnvelope));
  } finally {
    await prisma.$disconnect();
  }
}

runBridge().catch((err) => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
