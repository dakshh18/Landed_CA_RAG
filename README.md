# Landed — Agentic RAG Assistant for Canadian Newcomers

An AI assistant that answers Canadian immigration questions (Express Entry, study/work permits, PGWP, PNP, proof of funds) grounded in official IRCC / canada.ca sources. Every factual claim is cited, every answer carries a disclaimer, and the agent **refuses** rather than guess when no source supports an answer.

> ⚠️ Not official immigration advice. Always verify on [canada.ca](https://www.canada.ca).

---

## What makes it "agentic" RAG

Classic RAG retrieves top-k chunks once and generates. This one lets the model **decide what to do next** from a fixed set of tools, looping until it has a grounded answer or gives up:

| Tool | What it does | When |
|---|---|---|
| `retrieve_docs(query)` | Hybrid search (vector + full-text + RRF) over a pgvector corpus | First, for any immigration question |
| `web_search(query)` | Tavily search biased to canada.ca | Fallback when the corpus has nothing |
| `refuse(reason)` | Structured refusal | When no source supports an answer, or topic is out of scope |

The model streams its answer token-by-token over SSE, emitting citation events as it grounds each claim.

---

## Repository layout

```
landed_ca_ai/
├── backend/    Express + TypeScript API — ingestion, pgvector retrieval, agent loop, eval harness
└── frontend/   Next.js 14 (App Router) + Tailwind — streaming chat UI with inline citations
```

Each folder has its own detailed README:

- **[backend/README.md](backend/README.md)** — RAG concepts, the agent loop, SSE protocol, safety backstops, eval harness
- **[frontend/README.md](frontend/README.md)** — SSE parsing, citation chips, source panel, UI state machine

---

## Tech stack

| Layer | Tech |
|---|---|
| Backend | Node.js 20+, Express, TypeScript, `tsx` |
| Vector store | Postgres 16 + `pgvector` (HNSW index), full-text search (GIN) |
| Embeddings / LLM | OpenAI (1536-dim embeddings + function-calling chat model) |
| Web fallback | Tavily API (optional) |
| Frontend | Next.js 14 App Router, Tailwind CSS, TanStack Query, react-markdown |
| Transport | Server-Sent Events (SSE) for streaming tokens, tool activity, and citations |

---

## Quick start

### Prerequisites
- Node.js 20+
- Postgres 16 with the `pgvector` extension (Neon or Docker both work)
- An OpenAI API key (required); a Tavily API key (optional, enables `web_search`)

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env          # fill in OPENAI_API_KEY, DATABASE_URL, optionally TAVILY_API_KEY
npm run db:init               # apply schema (documents, chunks, indexes)
npm run ingest -- ./corpus    # embed + store the knowledge corpus
npm run dev                   # API on http://localhost:8080
```

### 2. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_API_URL (defaults to the backend on :8080)
npm run dev                        # UI on http://localhost:3000
```

Open <http://localhost:3000> and ask something like *"How does Express Entry work?"*

---

## Key API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness + DB / model status |
| `GET /api/documents` | Corpus listing (powers the sidebar) |
| `POST /api/chat` | SSE stream — `tool`, `token`, `citation`, `refuse`, `done`, `error` events |

See [backend/README.md](backend/README.md) for the full SSE event protocol and curl examples.

---

## Evaluation

The backend ships an eval harness (`npm run eval`) scoring recall@k, faithfulness, answer relevance, and refusal accuracy across a 16-question gold set (11 answerable, 5 deliberately unanswerable), with a hybrid-vs-vector-only A/B. Details in [backend/README.md](backend/README.md#7-run-the-eval-harness).

---

## Safety backstops

- **Max tool calls** cap so the agent loop always terminates.
- **Refuse threshold** — refuses when the best retrieved chunk scores too low.
- **Citations enforced** in the system prompt; ungrounded answers are flagged in the UI.
- **Mandatory disclaimer** on every non-refusal answer.
- **Rate limiting** on `/api/chat`, and a **stateless** API (no session storage to leak).
