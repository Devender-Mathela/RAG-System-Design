"""
Simple & Pure Math Evaluators for SystemIQ (LangSmith)
No complex magic. Transparent formulas:
- Recall: Hits / Expected
- Precision: 1 / Rank of first match
- F1: 2 * (P * R) / (P + R)
- Accuracy: Correct / Total
"""
import re
from typing import List, Dict, Any


# 1. RAG Evaluators
def evaluate_context_recall(retrieved: List[str], expected: List[str]) -> float:
    if not expected:
        return 1.0
    if not retrieved:
        return 0.0
    ret_set = {d.lower().strip() for d in retrieved}
    hits = sum(1 for exp in expected if any(exp.lower().strip() in r or r in exp.lower().strip() for r in ret_set))
    return round(hits / len(expected), 4)


def evaluate_context_precision(retrieved: List[str], expected: List[str]) -> float:
    if not expected or not retrieved:
        return 0.0
    exp_set = {d.lower().strip() for d in expected}
    for rank, doc in enumerate(retrieved, start=1):
        doc_clean = doc.lower().strip()
        if any(e in doc_clean or doc_clean in e for e in exp_set):
            return round(1.0 / rank, 4)
    return 0.0


def evaluate_concept_coverage(text: str, expected_concepts: List[str]) -> float:
    if not expected_concepts:
        return 1.0
    if not text:
        return 0.0
    text_lower = text.lower()
    matched = 0
    for concept in expected_concepts:
        words = [w.lower() for w in re.split(r'[\s/()-]+', concept) if len(w) > 3]
        if words and any(w in text_lower for w in words):
            matched += 1
    return round(matched / len(expected_concepts), 4)


# 2. Architecture Evaluators
def evaluate_spof(detected: List[str], expected: List[str]) -> Dict[str, float]:
    if not expected and not detected:
        return {'precision': 1.0, 'recall': 1.0, 'f1': 1.0}
    if not expected or not detected:
        return {'precision': 0.0, 'recall': 0.0, 'f1': 0.0}

    det_clean = [s.lower().strip() for s in detected]
    exp_clean = [s.lower().strip() for s in expected]

    tp = sum(1 for exp in exp_clean if any(exp in d or d in exp for d in det_clean))
    recall = tp / len(exp_clean)
    precision = tp / len(det_clean) if det_clean else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    return {'precision': round(precision, 4), 'recall': round(recall, 4), 'f1': round(f1, 4)}


def evaluate_component_accuracy(actual_metrics: Dict[str, Any], expected_metrics: Dict[str, Any]) -> float:
    categories = ['services', 'databases', 'caches', 'queues']
    matches = sum(1 for cat in categories if cat in expected_metrics and actual_metrics.get(cat) == expected_metrics[cat])
    total = sum(1 for cat in categories if cat in expected_metrics)
    return round(matches / total, 4) if total > 0 else 1.0


# 3. Interview Evaluators
def evaluate_verdict(actual_is_correct: bool, expected_verdict: bool) -> float:
    return 1.0 if actual_is_correct == expected_verdict else 0.0


def evaluate_technical_depth(candidate_answer: str, key_concepts: List[str]) -> float:
    return evaluate_concept_coverage(candidate_answer, key_concepts)
