# SystemIQ — LangSmith Evaluation Suite

A modular, production-ready evaluation framework for **SystemIQ (RAG-Based AI System Design & Interview Platform)** integrated with **LangSmith**.

---

## 🎯 Evaluation Focus Areas

### 1. RAG Evaluation
- **Context Recall**: Measures whether all expected reference architecture documents from the 15-document knowledge base were retrieved in the top-$k$ results.
- **Context Precision**: Rank-weighted Mean Reciprocal Rank (MRR) evaluating if the most authoritative pattern appears at position 1.
- **Faithfulness (Hallucination)**: Verifies that synthesized findings are strictly grounded in retrieved markdown contexts without fabricating non-existent mechanics.
- **Answer Correctness & Relevance**: Assesses concept coverage and semantic similarity against curated architectural guidelines.

### 2. Architecture & Metrics Engine Evaluation
- **SPOF Detection Recall, Precision & F1**: Validates detection of unreplicated stateful databases, single-instance services under high fan-in, and missing failover standby nodes.
- **Component Identification**: Verifies exact categorization of clients, API gateways, services, databases, caches, and message queues.
- **Dependency & Cycle Validation**: Tests cycle detection (e.g. Order $\to$ Payment $\to$ Inventory $\to$ Order deadlocks) and deep fan-out ratios.
- **Redundancy & Scalability Alignment**: Checks whether computed redundancy scores reflect true architectural resilience.

### 3. Interview Evaluation
- **Verdict Accuracy**: Compares binary pass/fail grading against ground-truth rubric.
- **Score Calibration**: Evaluates grading consistency across Staff, Mid, and Failing candidate responses.
- **Technical Depth**: Concept extraction measuring deep distributed systems principles (distributed mutex, Saga compensating transactions, sliding window rate limiters, CAP theorem trade-offs).
- **Feedback Quality**: Ensures actionable, constructive guidance surfacing concrete missing points.

### 4. Performance & Telemetry Monitoring
- **P50 / P90 / P95 / P99 Latency**: Accurate percentile tracking across all evaluation pipelines.
- **Token & Cost Telemetry**: Automatic calculation of prompt/completion tokens and estimated USD costs across Gemini 1.5/2.0 Flash, Groq Llama, and OpenAI models.
- **Reliability & Fallback Rates**: Tracks zero-downtime deterministic fallback triggers.

---

## 🚀 Quick Start

### 1. Link LangSmith (Optional - works locally offline as well)
In `server/.env`, specify your LangSmith API key:
```env
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_your_real_key_here
LANGSMITH_PROJECT=system-design-ai-eval
```

### 2. Run Evaluations

```bash
# Run complete evaluation suite across RAG, Architecture, and Interview
npm run eval

# Run individual pipelines
npm run eval:rag
npm run eval:arch
npm run eval:interview
```

### 3. Inspecting Results
- Detailed Markdown Report: `eval/EVALUATION_REPORT.md`
- Machine-Readable JSON Telemetry: `eval/results/eval_summary.json`
- Cloud Dashboard: [smith.langchain.com](https://smith.langchain.com/) under project `system-design-ai-eval`
