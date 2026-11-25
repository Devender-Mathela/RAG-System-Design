# SystemIQ — RAG-Based AI System Design & Interview Platform

> An interactive distributed system architecture studio and interview platform powered by deterministic graph analysis, pgvector RAG, and live AI evaluation.

---

## 🚀 Features

- **Interactive Architecture Studio**: Drag-and-drop system design whiteboard powered by React Flow (`@xyflow/react`).
- **Deterministic Graph Analysis**: In-memory graph traversal detecting Single Points of Failure (SPOFs), bottlenecks, and scalability gaps.
- **RAG-Powered Domain Reasoning**: Semantic retrieval against 15 distributed systems knowledge-base modules.
- **AI System Design Interviewer**: Live technical interview simulation with rubrics, technical depth scoring, and feedback.
- **Enterprise-Grade Evaluation**: Built-in, transparent LangSmith evaluation pipelines tracking faithfulness, precision, recall, and technical depth.

---

## 🛠️ Tech Stack

- **Frontend (`client/`)**: React 19, TypeScript, Vite, Tailwind CSS, `@xyflow/react`
- **Backend (`server/`)**: NestJS, TypeScript, Prisma ORM, WebSockets (`socket.io`), Swagger
- **Data & Caching**: SQLite (Dev) / PostgreSQL + pgvector, Redis (Caching & Rate Limiting)
- **Event Streaming**: Redpanda / Kafka (Async analysis workers)
- **Evaluation & Tracing**: LangSmith Cloud SDK, Groq / Gemini LLMs

---

## 📁 Project Structure

```text
├── client/          # Frontend Web Application (React + Vite)
├── server/          # Backend REST & WebSocket API (NestJS + Prisma)
├── docker/          # Docker Compose configurations (Postgres, Redis, Redpanda)
├── docs/            # Engineering blueprints & RAG knowledge base
│   ├── knowledge-base/   # 15 System Design reference documents for RAG
│   ├── architecture.md   # System architecture & data flow specification
│   ├── decision.md       # Architectural decisions log
│   └── design-system/    # Visual design tokens & styling guide
├── eval/            # LangSmith Cloud Evaluation Suite (Pure math evaluators)
├── scripts/         # Security scanning & pre-commit audits
├── .env             # Unified environment configuration
├── package.json     # Workspace management & root scripts
└── README.md        # Project guide
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: $\ge 20.x$
- **npm**: $\ge 10.x$

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd System-Design-with-AI
npm install
```

### 3. Environment Setup
Copy the example environment file:
```bash
cp .env.example .env
```
*(Add your `GROQ_API_KEY` or `GEMINI_API_KEY` in `.env`. Deterministic fallbacks activate automatically if keys are omitted).*

### 4. Database Setup & Knowledge Ingestion
```bash
cd server
npx prisma db push
npm run kb:ingest
cd ..
```

### 5. Run the Application
Start both frontend and backend concurrently:
```bash
npm run dev
```

- **Frontend Studio**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:4000](http://localhost:4000)
- **Swagger API Docs**: [http://localhost:4000/api/docs](http://localhost:4000/api/docs)

---

## 🧪 Testing & Evaluation

### Run Server Unit Tests
```bash
cd server
npm run test
```

### Security & Secret Leak Audit
```bash
npm run check:keys
```

### Run LangSmith Cloud Evaluations
Run direct benchmark experiments on LangSmith Cloud:
```bash
python eval/langsmith_eval.py
```

---

## 📜 License
MIT License.
