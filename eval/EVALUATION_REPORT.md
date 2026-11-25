# 📊 SystemIQ — LangSmith Live Evaluation Report

> **Source of Truth**: LangSmith Official Cloud Platform  
> **Tenant / Project**: `rag-system-desing`  
> **Mode**: Pure Cloud Evaluation (Direct test case execution on live LangSmith datasets)

---

## 🔗 Live LangSmith Dashboards

Sare test cases aur unke live scores LangSmith platform par available hain:

| Evaluation Suite | Test Cases | Primary Metrics | Direct Dashboard Link |
| :--- | :--- | :--- | :--- |
| **1. RAG Retrieval** | 8 Benchmark Queries | Context Recall, Context Precision, Concept Coverage | 🔗 [Open RAG Dashboard](https://smith.langchain.com/o/dc525750-5350-4a62-9bfb-437f100aafb1/datasets/63724e0f-a2b5-4121-8ad6-50ab5ddc63d3/compare?selectedSessions=ddd8aef4-68a9-4207-8758-457bc96d6d8f) |
| **2. Architecture Graph** | 5 Complex Architectures | SPOF F1, SPOF Recall, Component Accuracy, Redundancy | 🔗 [Open Architecture Dashboard](https://smith.langchain.com/o/dc525750-5350-4a62-9bfb-437f100aafb1/datasets/a9a618b9-7077-4bd7-93ed-87202a9a8b28/compare?selectedSessions=1b2ae91a-8d65-44ce-98b4-46b6a9d98437) |
| **3. Interview Grading** | 6 Candidate Answers | Verdict Accuracy, Technical Depth, Score Assigned | 🔗 [Open Interview Dashboard](https://smith.langchain.com/o/dc525750-5350-4a62-9bfb-437f100aafb1/datasets/21201411-90a4-4b9d-9435-02dda06b7fe5/compare?selectedSessions=54b0bedc-ac0f-42d8-aa5f-9dd70ac4a8c3) |

---

## 💡 Metrics Explanation (Easy & Simple)

1. **RAG Evaluation**:
   - `context_recall`: Kya sahi documents database se retrieve hue? (Formula: $\frac{\text{Hits}}{\text{Expected}}$)
   - `context_precision`: Sahi document search results me kitne top rank par aaya? (Formula: $\frac{1}{\text{Rank}}$)
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
