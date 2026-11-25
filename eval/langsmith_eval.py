"""
SystemIQ — LangSmith Direct Cloud Evaluation Runner
===================================================
Directly evaluates:
1. RAG Knowledge Base Retrieval
2. Architecture Graph & SPOF Traversal
3. Technical Interview Rubric Scoring

Results are sent directly to LangSmith Cloud without any offline/local masking.
"""
import os
import json
import time
import subprocess
from pathlib import Path
from dotenv import load_dotenv
from langsmith import Client, evaluate

from evaluators.evaluators import (
    evaluate_context_recall,
    evaluate_context_precision,
    evaluate_concept_coverage,
    evaluate_spof,
    evaluate_component_accuracy,
    evaluate_verdict,
    evaluate_technical_depth
)

# 1. Setup & Connect to LangSmith
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / '.env')

api_key = os.getenv('LANGSMITH_API_KEY')
if not api_key:
    raise ValueError("LANGSMITH_API_KEY is missing from .env file!")

client = Client()
tenant_project = os.getenv('LANGSMITH_PROJECT', 'rag-system-desing')
print(f"✨ Connected to LangSmith Cloud (Project: {tenant_project})")


# 2. Bridge to Backend Services
def call_backend(action: str, payload: dict) -> tuple[dict, float]:
    """Invokes NestJS backend services via fast in-memory eval_bridge."""
    req = {'batch': [{'id': 'item', 'action': action, **payload}]}
    temp_in = ROOT_DIR / 'eval' / f'temp_in_{os.getpid()}_{time.time_ns()}.json'
    temp_out = ROOT_DIR / 'eval' / f'temp_out_{os.getpid()}_{time.time_ns()}.json'

    with open(temp_in, 'w', encoding='utf-8') as f:
        json.dump(req, f)

    cmd = f'npx ts-node scripts/eval_bridge.ts --input="{temp_in}" --output="{temp_out}"'
    subprocess.run(cmd, cwd=str(ROOT_DIR / 'server'), shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)

    data, duration_ms = {}, 0.0
    if temp_out.exists():
        with open(temp_out, 'r', encoding='utf-8') as f:
            res = json.load(f)
        item = res.get('results', [{}])[0]
        data = item.get('data', {})
        duration_ms = item.get('durationMs', 0.0)
        temp_in.unlink(missing_ok=True)
        temp_out.unlink(missing_ok=True)

    return data, duration_ms


# ==============================================================================
# PIPELINE 1: RAG RETRIEVAL EVALUATION
# ==============================================================================
def run_rag_pipeline(inputs: dict) -> dict:
    data, duration = call_backend('rag', {'query': inputs.get('query', ''), 'limit': 3})
    results = data.get('searchResults', [])
    retrieved_keys = [d.get('docKey', '') for d in results]
    retrieved_text = " ".join([f"{d.get('title')}: {d.get('summary')}" for d in results])
    return {'retrieved_docs': retrieved_keys, 'retrieved_text': retrieved_text, 'latency_ms': duration}

def rag_recall(run, example) -> dict:
    score = evaluate_context_recall(run.outputs.get('retrieved_docs', []), example.outputs.get('expected_doc_keys', []))
    return {'key': 'context_recall', 'score': score}

def rag_precision(run, example) -> dict:
    score = evaluate_context_precision(run.outputs.get('retrieved_docs', []), example.outputs.get('expected_doc_keys', []))
    return {'key': 'context_precision', 'score': score}

def rag_concepts(run, example) -> dict:
    score = evaluate_concept_coverage(run.outputs.get('retrieved_text', ''), example.inputs.get('expected_concepts', []))
    return {'key': 'concept_coverage', 'score': score}

def rag_latency(run, example) -> dict:
    return {'key': 'latency_ms', 'score': run.outputs.get('latency_ms', 0.0)}


# ==============================================================================
# PIPELINE 2: ARCHITECTURE GRAPH EVALUATION
# ==============================================================================
def run_architecture_pipeline(inputs: dict) -> dict:
    data, duration = call_backend('architecture', {
        'nodes': inputs.get('nodes', []),
        'edges': inputs.get('edges', []),
        'systemContext': inputs.get('systemContext', '')
    })
    metrics = data.get('metrics', {})
    violations = data.get('violations', [])
    detected_spofs = list(set(metrics.get('spof', []) + data.get('critique', {}).get('analysis', {}).get('spofRisks', [])))
    clean_spofs = [s for s in detected_spofs if not any(neg in s.lower() for neg in ['none', 'zero', 'no direct', 'no spof'])]
    return {'metrics': metrics, 'violations': violations, 'spofs': clean_spofs, 'latency_ms': duration}

def arch_spof_f1(run, example) -> dict:
    res = evaluate_spof(run.outputs.get('spofs', []), example.outputs.get('expected_spofs', []))
    return {'key': 'spof_f1_score', 'score': res['f1']}

def arch_spof_recall(run, example) -> dict:
    res = evaluate_spof(run.outputs.get('spofs', []), example.outputs.get('expected_spofs', []))
    return {'key': 'spof_recall', 'score': res['recall']}

def arch_component_acc(run, example) -> dict:
    score = evaluate_component_accuracy(run.outputs.get('metrics', {}), example.outputs.get('expected_metrics', {}))
    return {'key': 'component_accuracy', 'score': score}

def arch_redundancy_score(run, example) -> dict:
    return {'key': 'redundancy_score', 'score': float(run.outputs.get('metrics', {}).get('redundancyScore', 0))}

def arch_latency(run, example) -> dict:
    return {'key': 'latency_ms', 'score': run.outputs.get('latency_ms', 0.0)}


# ==============================================================================
# PIPELINE 3: INTERVIEW EVALUATION
# ==============================================================================
def run_interview_pipeline(inputs: dict) -> dict:
    data, duration = call_backend('interview_eval', {
        'question': inputs.get('question', ''),
        'idealAnswer': inputs.get('idealAnswer', ''),
        'keyConcepts': inputs.get('keyConcepts', []),
        'userAnswer': inputs.get('candidateAnswer', '')
    })
    return {'eval': data.get('evaluation', {}), 'latency_ms': duration}

def interview_verdict(run, example) -> dict:
    act = run.outputs.get('eval', {}).get('isCorrect', False)
    exp = example.outputs.get('expected_verdict', False)
    return {'key': 'verdict_accuracy', 'score': evaluate_verdict(act, exp)}

def interview_depth(run, example) -> dict:
    score = evaluate_technical_depth(example.inputs.get('candidateAnswer', ''), example.inputs.get('keyConcepts', []))
    return {'key': 'technical_depth', 'score': score}

def interview_score_assigned(run, example) -> dict:
    return {'key': 'score_assigned', 'score': float(run.outputs.get('eval', {}).get('accuracyScore', 0))}

def interview_latency(run, example) -> dict:
    return {'key': 'latency_ms', 'score': run.outputs.get('latency_ms', 0.0)}


# ==============================================================================
# MAIN EXECUTION: DIRECT LANGSMITH EVALUATE
# ==============================================================================
def main():
    print("\n" + "="*70)
    print("🚀 RUNNING DIRECT LANGSMITH BENCHMARKS (Cloud Only, No Offline Mode)")
    print("="*70)

    # 1. RAG
    print("\n[1/3] 🔍 Running RAG Knowledge Retrieval on LangSmith...")
    rag_exp = evaluate(
        run_rag_pipeline,
        data='systemiq-rag-eval-dataset',
        evaluators=[rag_recall, rag_precision, rag_concepts, rag_latency],
        experiment_prefix='rag-eval',
        client=client
    )

    # 2. Architecture
    print("\n[2/3] 🏗️  Running Architecture Graph & SPOF on LangSmith...")
    arch_exp = evaluate(
        run_architecture_pipeline,
        data='systemiq-architecture-eval-dataset',
        evaluators=[arch_spof_f1, arch_spof_recall, arch_component_acc, arch_redundancy_score, arch_latency],
        experiment_prefix='architecture-eval',
        client=client
    )

    # 3. Interview
    print("\n[3/3] 🎓 Running Interview Rubric on LangSmith...")
    interview_exp = evaluate(
        run_interview_pipeline,
        data='systemiq-interview-eval-dataset',
        evaluators=[interview_verdict, interview_depth, interview_score_assigned, interview_latency],
        experiment_prefix='interview-eval',
        client=client
    )

    rag_url = getattr(rag_exp, 'url', 'N/A')
    arch_url = getattr(arch_exp, 'url', 'N/A')
    interview_url = getattr(interview_exp, 'url', 'N/A')

    print("\n" + "="*70)
    print("🎉 ALL TEST CASES SUCCESSFULLY EVALUATED IN LANGSMITH!")
    print("="*70)
    print(f"🔗 1. RAG Dashboard         : {rag_url}")
    print(f"🔗 2. Architecture Dashboard: {arch_url}")
    print(f"🔗 3. Interview Dashboard   : {interview_url}")
    print("="*70 + "\n")

    # Generate Simple, Beginner-Friendly Report
    report_content = f"""# 📊 SystemIQ — LangSmith Live Evaluation Report

> **Source of Truth**: LangSmith Official Cloud Platform  
> **Tenant / Project**: `{tenant_project}`  
> **Mode**: Pure Cloud Evaluation (Direct test case execution on live LangSmith datasets)

---

## 🔗 Live LangSmith Dashboards

Sare test cases aur unke live scores LangSmith platform par available hain:

| Evaluation Suite | Test Cases | Primary Metrics | Direct Dashboard Link |
| :--- | :--- | :--- | :--- |
| **1. RAG Retrieval** | 8 Benchmark Queries | Context Recall, Context Precision, Concept Coverage | 🔗 [Open RAG Dashboard]({rag_url}) |
| **2. Architecture Graph** | 5 Complex Architectures | SPOF F1, SPOF Recall, Component Accuracy, Redundancy | 🔗 [Open Architecture Dashboard]({arch_url}) |
| **3. Interview Grading** | 6 Candidate Answers | Verdict Accuracy, Technical Depth, Score Assigned | 🔗 [Open Interview Dashboard]({interview_url}) |

---

## 💡 Metrics Explanation (Easy & Simple)

1. **RAG Evaluation**:
   - `context_recall`: Kya sahi documents database se retrieve hue? (Formula: $\\frac{{\\text{{Hits}}}}{{\\text{{Expected}}}}$)
   - `context_precision`: Sahi document search results me kitne top rank par aaya? (Formula: $\\frac{{1}}{{\\text{{Rank}}}}$)
   - `concept_coverage`: Kya query ke technical concepts retrieved text me present hain?

2. **Architecture Evaluation**:
   - `spof_recall`: System design ke Single Points of Failure kitne detect hue?
   - `spof_f1_score`: SPOF detection ka balance score between precision aur recall.
   - `component_accuracy`: Services, Databases, Queues, Caches ki counting ki accuracy.

3. **Interview Evaluation**:
   - `verdict_accuracy`: Pass/Fail verdict standard answer rubric se match hua ya nahi (1.0 = Match, 0.0 = Mismatch).
   - `technical_depth`: Candidate ke answer me required technical concepts ka ratio.
   - `score_assigned`: AI interviewer dwara diya gaya original score (0-100).

---

## 🚀 How to Run Evaluation

LangSmith par evaluation run karne ke liye:
```bash
python eval/langsmith_eval.py
```
"""
    with open(ROOT_DIR / 'eval' / 'EVALUATION_REPORT.md', 'w', encoding='utf-8') as f:
        f.write(report_content)
    print("📄 Clean, beginner-friendly report written to: eval/EVALUATION_REPORT.md")


if __name__ == '__main__':
    main()
