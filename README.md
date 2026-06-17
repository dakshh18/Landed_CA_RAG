# Landed — Agentic RAG Assistant for Canadian Newcomers

An AI assistant that answers Canadian immigration questions (Express Entry, study/work permits, PGWP, PNP, proof of funds) grounded in official IRCC / canada.ca sources. Every factual claim is cited, every answer carries a disclaimer, and the agent **refuses** rather than guess when no source supports an answer.

> ⚠️ Not official immigration advice. Always verify on [canada.ca](https://www.canada.ca).

**Live:** [landed-ca-rag.vercel.app](https://landed-ca-rag.vercel.app) · **API:** `https://landed-canada.duckdns.org`

---

## What makes it "agentic" RAG

Classic RAG retrieves top-k chunks once and generates. This one lets the model **decide what to do next** from a fixed set of tools, looping until it has a grounded answer or gives up:

| Tool | What it does | When |
|---|---|---|
| `retrieve_docs(query)` | Hybrid search (vector + full-text + RRF) over a pgvector corpus | First, for any immigration question |
| `web_search(query)` | Tavily search biased to canada.ca | Fallback when the corpus has nothing |
| `refuse(reason)` | Structured refusal | When no source supports an answer, or the topic is out of scope |

The loop: model emits a tool call → we execute it server-side → the result goes back into the conversation → the model decides again. It stops when the model produces a final answer or hits a safety cap. The answer streams token-by-token over SSE, emitting citation events as it grounds each claim.

```
user msg ──► [system prompt + history] ──► LLM (stream)
                                          │
                              ┌───────────┴───────────┐
                       tokens │                       │ tool_calls
                              ▼                       ▼
                         SSE stream             execute tool  ──┐
                              │                       │         │
                              │                  tool result    │
                              │                       │         │
                              │                       └─────────┘
                              ▼                  (loop until "stop" or
                            done                  MAX_TOOL_CALLS hit)
```

---

## Architecture

```
   Browser
      │  HTTPS
      ▼
┌──────────────┐         ┌─────────────────────────────────────┐
│   Vercel     │  HTTPS  │            AWS EC2 (Ubuntu)          │
│ (Next.js FE) │ ──────► │  Caddy — TLS via Let's Encrypt :443  │
└──────────────┘         │     │                                │
                         │     ▼                                │
                         │  backend container (Express :8080)   │
                         └─────────────────────────────────────┘
                                 │           │            │
                                 ▼           ▼            ▼
                          Neon (pgvector)  OpenAI       Tavily
```

The frontend is a static/SSR app on Vercel's CDN. The backend is a Docker container on a single EC2 box, fronted by Caddy (which auto-provisions and renews the HTTPS certificate). The vector database is fully managed by Neon. See [Deployment](#deployment-production) for the full workflow.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 App Router, Tailwind CSS, TanStack Query, react-markdown |
| Backend | Node.js 20+, Express, TypeScript, `tsx` |
| Vector store | Postgres 16 + `pgvector` (HNSW index) + full-text search (GIN), hosted on **Neon** |
| Embeddings / LLM | OpenAI (1536-dim embeddings + function-calling chat model) |
| Web fallback | Tavily API (optional) |
| Transport | Server-Sent Events (SSE) for streaming tokens, tool activity, and citations |
| Deployment | Docker image on Docker Hub → EC2 + Caddy reverse proxy; frontend on Vercel |

---

## Repository layout

```
landed_ca_ai/
├── backend/                Express + TypeScript API
│   ├── src/
│   │   ├── config/env.ts    Zod-validated env (crashes early on missing keys)
│   │   ├── db/              schema.sql (pgvector + HNSW + GIN), pool, init
│   │   ├── ingestion/       chunk + embed + ingest CLI
│   │   ├── retrieval/       hybrid search (vector + full-text + RRF)
│   │   ├── agent/           prompts, tools, orchestrator (the agent loop)
│   │   ├── routes/          health, documents, chat (SSE)
│   │   ├── eval/            16-question gold set + eval harness
│   │   └── server.ts        Express bootstrap
│   ├── corpus/             IRCC / canada.ca source PDFs (+ sidecar metadata JSON)
│   └── Dockerfile           multi-stage build → lean runtime image
├── frontend/               Next.js 14 chat UI
│   ├── app/                 page + layout
│   ├── components/          chat/, sidebar/, layout/
│   ├── hooks/useChatStream.ts   SSE parser + UI state machine
│   └── lib/api.ts           typed fetch wrapper
├── docker-compose.yml      production stack: backend + caddy
└── Caddyfile               reverse proxy + auto-HTTPS config
```

### Codebase tour — the concept each file teaches

**Backend**
| File | Concept |
|---|---|
| `src/ingestion/embed.ts` | What an embedding is; batched OpenAI embedding calls |
| `src/ingestion/chunk.ts` | Why we chunk; `fixed` vs `semantic` strategies |
| `src/retrieval/hybrid.ts` | Hybrid search + Reciprocal Rank Fusion; vector-only mode for the eval A/B |
| `src/db/schema.sql` | HNSW vs GIN indexes, the `<=>` cosine-distance operator |
| `src/agent/prompts.ts` | System-prompt design: citation, disclaimer, refuse rules |
| `src/agent/tools.ts` | Tool use / function calling + the citation registry |
| `src/agent/orchestrator.ts` | The agent loop, streaming, tool-call fragments, refuse backstop |
| `src/routes/chat.ts` | The SSE event protocol |
| `src/eval/run-eval.ts` | LLM-as-judge, recall@k |

**Frontend**
| File | Concept |
|---|---|
| `hooks/useChatStream.ts` | SSE parsing with a streaming `TextDecoder`; UI state machine |
| `components/chat/AssistantContent.tsx` | Injecting `CitationChip`s into rendered Markdown by walking the tree |
| `components/chat/SourcePanel.tsx` | Slide-out panel showing the exact cited passage |
| `components/chat/ChatWindow.tsx` | Autoscroll that pins to bottom unless the user scrolls up |

---

## Local development

### Prerequisites
- Node.js 20+
- Postgres 16 with the `pgvector` extension (a free [Neon](https://neon.tech) project or a local Docker Postgres both work)
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

Optional sanity checks:
```bash
npm run retrieve -- "How is a candidate ranked in Express Entry?"   # retrieval only, no LLM
npm run ingest -- ./corpus --strategy semantic                      # semantic chunking (for the eval A/B)
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

## Environment variables

### Backend (`backend/.env`)
| Var | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | Postgres connection. For Neon, append `?sslmode=require` |
| `OPENAI_API_KEY` | ✅ | — | Embeddings + chat completions |
| `PORT` | | `8080` | API port |
| `TAVILY_API_KEY` | | — | Enables the `web_search` tool (skipped if absent) |
| `EMBEDDING_MODEL` | | `text-embedding-3-small` | 1536-dim embedding model |
| `CHAT_MODEL` | | `gpt-4o-mini` | Function-calling chat model |
| `RETRIEVAL_K` | | `8` | Top-k chunks per retrieval |
| `REFUSE_THRESHOLD` | | `0.25` | Refuse when the best chunk's RRF score is below this |
| `MAX_TOOL_CALLS` | | `4` | Hard cap so the agent loop always terminates |
| `CORS_ORIGIN` | | `http://localhost:3000` | Allowed frontend origin (set to the Vercel URL in prod) |

### Frontend (`frontend/.env.local`, or Vercel project env)
| Var | Required | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | ✅ in prod | `http://localhost:8080` | Backend base URL. **Inlined at build time** — change it and you must rebuild/redeploy |

---

## API + SSE protocol

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness + DB / model status (`{ status, db, model, embeddingModel }`) |
| `GET /api/documents` | Corpus listing (powers the sidebar) |
| `POST /api/chat` | SSE stream of the agent's response |

`POST /api/chat` is stateless — the client sends the full `messages[]` each turn — and streams these events:

| event | data shape | when |
|---|---|---|
| `tool` | `{ name, status: "running" \| "done", query? }` | A tool started or finished |
| `token` | `{ text }` | A streamed delta of assistant text |
| `citation` | `{ id, title, url, page, fetchedAt, passage, source }` | Once per `[n]` used in the answer |
| `refuse` | `{ reason }` | The agent refused; no answer text follows |
| `done` | `{ latencyMs, toolCalls, refused }` | Stream complete |
| `error` | `{ message }` | Unexpected failure |

```bash
curl -N -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"How is a candidate ranked in Express Entry?"}]}'
```

---

## Evaluation

The backend ships an eval harness scoring recall@k, faithfulness, answer relevance, and refusal accuracy across a 16-question gold set (11 answerable, 5 deliberately unanswerable), with a hybrid-vs-vector-only A/B.

```bash
npm run eval                       # hybrid retrieval (default)
npm run eval -- --mode vector      # vector-only — for the comparison
npm run eval -- --limit 3          # quick smoke run on 3 questions
```

Each run writes a JSON record to `src/eval/results/` and prints a summary (recall@k, faithfulness, relevance, refusal accuracy, avg latency, avg tool calls). To reproduce the full comparison table, run the eval under each chunking × retrieval combination:

```bash
npm run ingest -- ./corpus --strategy fixed     && npm run eval
npm run ingest -- ./corpus --strategy fixed     && npm run eval -- --mode vector
npm run ingest -- ./corpus --strategy semantic  && npm run eval
npm run ingest -- ./corpus --strategy semantic  && npm run eval -- --mode vector
```

---

## Safety backstops

- **Max tool calls** (`MAX_TOOL_CALLS`) so the agent loop always terminates.
- **Refuse threshold** (`REFUSE_THRESHOLD`) — refuses when the best retrieved chunk scores too low, even after web search.
- **Citations enforced** in the system prompt; every factual sentence ends with `[n]`, and the UI flags non-refusal answers that arrive ungrounded.
- **Mandatory disclaimer** on every non-refusal answer (the canada.ca verify line).
- **Rate limiting** on the API, and a **stateless** design (no session storage to leak).

---

## Deployment (production)

The app runs as three managed pieces:

| Piece | Where | How |
|---|---|---|
| Frontend | **Vercel** | Next.js, root directory `frontend`, env `NEXT_PUBLIC_API_URL` → the API |
| Backend API | **AWS EC2** (Ubuntu) | Docker container behind Caddy (auto-HTTPS) |
| Database | **Neon** | Serverless Postgres + pgvector (`us-east-1`) |

The backend is containerized via [`backend/Dockerfile`](backend/Dockerfile) (multi-stage: compile TypeScript, ship a lean runtime image) and published to Docker Hub as `dakshlearndocker/landed-backend`. On the EC2 box, [`docker-compose.yml`](docker-compose.yml) runs two containers — the backend and a [Caddy](Caddyfile) reverse proxy that terminates HTTPS for `landed-canada.duckdns.org` and forwards to the backend on `:8080`. The box's `.env` (never committed) supplies the image tag, domain, Neon URL, and secrets.

**One-time bootstrap** (run once against Neon, from a machine with the corpus):
```bash
cd backend
npm run db:init      # create extension, tables, indexes
npm run ingest -- corpus
```

**Deploy / update the backend:**
```bash
# 1. Build & push (dev machine)
docker build --platform linux/amd64 -t dakshlearndocker/landed-backend:latest ./backend
docker push dakshlearndocker/landed-backend:latest

# 2. Pull & restart (on the EC2 box, in the deploy folder)
docker compose pull backend
docker compose up -d
```

**Frontend:** Vercel auto-deploys on push to `main`. Set `NEXT_PUBLIC_API_URL` to the API URL in the Vercel project settings, and make sure the backend's `CORS_ORIGIN` matches the Vercel origin.

> **Note:** a default EC2 public IP changes on stop/start — attach an Elastic IP for a stable address, or re-point DuckDNS after a restart.
