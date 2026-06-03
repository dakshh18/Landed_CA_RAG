# Landed — Backend

Agentic RAG assistant for Canadian newcomers. Built in two phases.

- **Phase 1 — data + retrieval foundation** (ingestion, embeddings, pgvector, hybrid search, REST routes)
- **Phase 2 — AI agent + streaming + evaluation** (function-calling loop, SSE, eval harness) ← *now*

---

## What "agentic RAG" means (plain English)

Classic RAG: retrieve top-k chunks, stuff them into a prompt, generate. One shot, no thinking.

**Agentic RAG:** the model *decides* what to do next from a fixed list of tools — search our corpus, search the web, or refuse. We loop: model emits a tool call → we execute it server-side → result goes back into the conversation → model decides again. The loop stops when the model produces a final answer or hits a safety cap.

In this codebase the model has three tools:

| Tool | Implementation | When the model uses it |
|---|---|---|
| `retrieve_docs(query)` | Hybrid search over our pgvector corpus | First, for any immigration question |
| `web_search(query)` | Tavily API biased to canada.ca | Fallback when the corpus has nothing |
| `refuse(reason)` | Structured refusal | When no source supports an answer, or topic is out of scope |

The whole flow:

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

## Build status

| File | Phase | Purpose |
|---|---|---|
| [src/config/env.ts](src/config/env.ts) | 1 | Zod-validated env, crashes early on missing keys |
| [src/db/schema.sql](src/db/schema.sql) | 1 | `documents`, `chunks`, pgvector + HNSW + GIN indexes |
| [src/db/pool.ts](src/db/pool.ts), [src/db/init.ts](src/db/init.ts) | 1 | Shared pg pool; `npm run db:init` applies schema |
| [src/ingestion/chunk.ts](src/ingestion/chunk.ts) | 1 | `fixed` and `semantic` chunking strategies |
| [src/ingestion/embed.ts](src/ingestion/embed.ts) | 1 | Batched OpenAI embeddings (1536-dim) |
| [src/ingestion/ingest.ts](src/ingestion/ingest.ts) | 1 | `npm run ingest -- ./corpus` |
| [src/retrieval/hybrid.ts](src/retrieval/hybrid.ts) | 1 + 2 | Vector + full-text + RRF; now supports vector-only mode for the eval A/B |
| [src/retrieval/cli.ts](src/retrieval/cli.ts) | 1 | `npm run retrieve -- "..."` sanity check |
| [src/routes/health.ts](src/routes/health.ts) | 1 | `GET /api/health` |
| [src/routes/documents.ts](src/routes/documents.ts) | 1 | `GET /api/documents` (corpus listing) |
| [src/agent/prompts.ts](src/agent/prompts.ts) | 2 | System prompt: citation, disclaimer, refuse rules |
| [src/agent/tools.ts](src/agent/tools.ts) | 2 | Tool schemas + handlers + citation registry |
| [src/agent/orchestrator.ts](src/agent/orchestrator.ts) | 2 | Function-calling loop, streaming, refuse backstop |
| [src/routes/chat.ts](src/routes/chat.ts) | 2 | `POST /api/chat` SSE stream |
| [src/eval/gold.json](src/eval/gold.json) | 2 | 16 gold questions (11 answerable, 5 deliberately unanswerable) |
| [src/eval/run-eval.ts](src/eval/run-eval.ts) | 2 | recall@k + faithfulness + relevance + refusal + comparison table |

---

## Key AI concepts in this code (read these comments first)

- **What RAG is** → top of this README
- **What an embedding is** → header in [src/ingestion/embed.ts](src/ingestion/embed.ts)
- **Why we chunk + fixed vs semantic** → header in [src/ingestion/chunk.ts](src/ingestion/chunk.ts)
- **Hybrid search + Reciprocal Rank Fusion** → header in [src/retrieval/hybrid.ts](src/retrieval/hybrid.ts)
- **HNSW vs GIN, the `<=>` operator** → [src/db/schema.sql](src/db/schema.sql)
- **System prompt design** → [src/agent/prompts.ts](src/agent/prompts.ts)
- **Tool use / function calling** → header in [src/agent/tools.ts](src/agent/tools.ts)
- **The agent loop + streaming + tool-call fragments** → header in [src/agent/orchestrator.ts](src/agent/orchestrator.ts)
- **SSE event protocol** → header in [src/routes/chat.ts](src/routes/chat.ts)
- **LLM-as-judge + recall@k** → header in [src/eval/run-eval.ts](src/eval/run-eval.ts)

---

## Setup

### 1. Prerequisites
- Node.js 20+
- A Postgres 16 with `pgvector` (Neon works, Docker works)
- OpenAI API key (required)
- Tavily API key (optional — enables `web_search`; without it the agent skips that tool)

### 2. Install + configure
```bash
cd backend
npm install
cp .env.example .env   # fill in OPENAI_API_KEY, DATABASE_URL, optionally TAVILY_API_KEY
npm run db:init
```

### 3. Ingest the corpus
Drop 8–12 IRCC / canada.ca PDFs into [corpus/](corpus/) (see the list in [BACKEND (1).md](../BACKEND%20(1).md) §10). Optional per-PDF sidecar `<name>.json` for `title`, `source_url`, `fetched_at`.

```bash
npm run ingest -- ./corpus                       # fixed chunking
npm run ingest -- ./corpus --strategy semantic   # for the eval A/B
```

### 4. Smoke test retrieval (no LLM call)
```bash
npm run retrieve -- "How is a candidate ranked in Express Entry?"
```

### 5. Run the API
```bash
npm run dev
```
- `GET /api/health` — `{ status, db, model, embeddingModel }`
- `GET /api/documents` — corpus listing for the UI sidebar
- `POST /api/chat` — SSE stream (see below)

### 6. Test the chat stream from the command line
```bash
curl -N -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"How is a candidate ranked in Express Entry?"}]}'
```
You'll see lines like:
```
event: tool
data: {"name":"retrieve_docs","status":"running","query":"..."}

event: token
data: {"text":"Express Entry uses the "}

event: citation
data: {"id":1,"title":"...","page":2,"url":"...","fetchedAt":"2026-05-20", ...}

event: done
data: {"latencyMs":1840,"toolCalls":1,"refused":false}
```

### 7. Run the eval harness
```bash
npm run eval                       # hybrid retrieval (default)
npm run eval -- --mode vector      # vector-only — for the comparison
npm run eval -- --limit 3          # quick smoke run on 3 questions
```
Writes a JSON record per run to `src/eval/results/`. The console prints a table and a summary like:
```
mode:              hybrid
recall@k:          81.8%
faithfulness:      90.9%
relevance:         100.0%
refusal accuracy:  87.5%
avg latency:       2143ms
avg tool calls:    1.25
```

To produce the comparison table the spec asks for, run the four combos (re-ingesting under each chunking strategy):

```bash
npm run ingest -- ./corpus --strategy fixed     && npm run eval
npm run ingest -- ./corpus --strategy fixed     && npm run eval -- --mode vector
npm run ingest -- ./corpus --strategy semantic  && npm run eval
npm run ingest -- ./corpus --strategy semantic  && npm run eval -- --mode vector
```
Drop the four summaries into your project-root README.

---

## SSE event protocol (for the frontend)

| event | data shape | when |
|---|---|---|
| `tool` | `{ name, status: "running"\|"done", query? }` | A tool started or finished |
| `token` | `{ text }` | A streamed delta of assistant text |
| `citation` | `{ id, title, url, page, fetchedAt, passage, source }` | Once per `[n]` actually used in the answer |
| `refuse` | `{ reason }` | The agent refused; no answer text follows |
| `done` | `{ latencyMs, toolCalls, refused }` | Stream complete |
| `error` | `{ message }` | Unexpected failure |

---

## Safety backstops (real interview talking points)

- **Max tool calls** — `MAX_TOOL_CALLS=4` in `.env`. The loop terminates even if the model is being silly.
- **Refuse threshold** — `REFUSE_THRESHOLD=0.25`. After the model has tried both retrieval and web search and the best chunk is still below this RRF score, we explicitly tell the model to refuse.
- **Citations enforced in the prompt** — every factual sentence must end with `[n]`. The frontend can show an "ungrounded" warning if a non-refusal answer arrives with no citations (mirrors this rule).
- **Disclaimer line** — every non-refusal answer ends with the canada.ca verify line. Built into the system prompt.
- **Rate limit on `/api/chat`** — 20 req/min per IP. LLM calls cost money.
- **Stateless API** — the frontend sends the full `messages[]` each turn. No session storage to leak.

---

## What's next (frontend)

Phase 1 + 2 of the backend are complete. The frontend in [FRONTEND (1).md](../FRONTEND%20(1).md) consumes:
- `GET /api/documents` for the sidebar
- `POST /api/chat` SSE for the chat surface, with `useChatStream` parsing the events above
- `CitationChip` + `SourcePanel` rendering the citation events

When you're ready, we'll build that.
