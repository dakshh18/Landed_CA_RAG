# Landed — Frontend

Next.js 14 App Router + TypeScript + Tailwind. Consumes the backend's SSE stream and renders a chat surface with inline citations, a slide-out source panel, tool-activity pill, refuse state, and latency badges.

- **Phase 1** — layout shell, sidebar with live corpus, composer, disclaimer.
- **Phase 2** — `useChatStream`, message bubbles (user/assistant/refuse), citation chips, source panel, tool activity, autoscroll, markdown rendering. ← *now*

---

## What "streaming chat with citations" means (plain English)

The backend sends back a **stream** of small events instead of one big response:

```
event: tool        data: {"name":"retrieve_docs","status":"running"}
event: token       data: {"text":"Express "}
event: token       data: {"text":"Entry uses "}
event: citation    data: { id: 1, title: "...", page: 2, url: "...", fetchedAt: "..."}
event: done        data: {"latencyMs":1840,"toolCalls":1}
```

The frontend's job is to:
1. Parse those events as they arrive (no waiting for the whole answer).
2. Update the UI live — tool pill while a tool runs, tokens appearing one by one.
3. When a `citation` event comes in, store its metadata; when the user clicks `[1]` in the rendered answer, show the exact passage in a slide-out panel.

That's the whole game. Everything in this folder serves it.

---

## File map

| Piece | File | What it does |
|---|---|---|
| State machine | [hooks/useChatStream.ts](hooks/useChatStream.ts) | Parses SSE, manages `messages` + `status` + `currentTool`; supports abort/reset |
| Markdown + citation chips | [components/chat/AssistantContent.tsx](components/chat/AssistantContent.tsx) | `react-markdown` + custom walker that swaps `[n]` strings for `CitationChip` |
| Citation chip | [components/chat/CitationChip.tsx](components/chat/CitationChip.tsx) | Inline red badge; clickable; highlighted when its source panel is open |
| Source panel | [components/chat/SourcePanel.tsx](components/chat/SourcePanel.tsx) | Slide-out right panel: title, page, "as of" date, full passage, canada.ca link |
| Tool activity | [components/chat/ToolActivity.tsx](components/chat/ToolActivity.tsx) | Animated pill: "Searching IRCC documents…" / "Checking canada.ca…" |
| Message bubble | [components/chat/MessageBubble.tsx](components/chat/MessageBubble.tsx) | user / assistant / refuse variants + latency badge + ungrounded warning |
| Chat window | [components/chat/ChatWindow.tsx](components/chat/ChatWindow.tsx) | Message list, autoscroll (pauses if user scrolls up), mounts `ToolActivity` |
| Composer | [components/chat/Composer.tsx](components/chat/Composer.tsx) | Auto-grow textarea, Enter-to-send, disabled while turn in flight |
| Corpus list | [components/sidebar/CorpusList.tsx](components/sidebar/CorpusList.tsx) | Live `GET /api/documents` via TanStack Query |
| Disclaimer banner | [components/layout/DisclaimerBanner.tsx](components/layout/DisclaimerBanner.tsx) | Persistent "not official advice" strip |
| Page | [app/page.tsx](app/page.tsx) | Top-level state: composer draft, language, which citation is open |

---

## Key concepts (read these comments first)

- **SSE parsing** → header of [hooks/useChatStream.ts](hooks/useChatStream.ts). How frames are framed, why we use a `TextDecoder` with `stream: true`.
- **State machine** → same file. The states map 1:1 to visible UI states (spinner / tool pill / streaming cursor / refuse banner).
- **Citation injection into Markdown** → header of [components/chat/AssistantContent.tsx](components/chat/AssistantContent.tsx). Why we walk the rendered tree instead of pre-processing the text.
- **Autoscroll behaviour** → [components/chat/ChatWindow.tsx](components/chat/ChatWindow.tsx). Pin to bottom unless the user scrolls up — small detail that makes the UI feel right.

---

## Setup

### 1. Install
```powershell
cd frontend
npm install
copy .env.local.example .env.local
```

### 2. Make sure the backend is running
```powershell
cd ..\backend
npm run dev
```

### 3. Start the frontend
```powershell
cd ..\frontend
npm run dev
```
Open <http://localhost:3000>.

---

## Try it

Click any of the welcome chips, e.g. **"How does Express Entry work?"** You should see, in order:

1. Your message appears as a navy bubble on the right.
2. A pill: **"Searching IRCC documents…"** (with a pulsing red dot).
3. The pill disappears as tokens start streaming in (with a blinking cursor at the end of the in-progress answer).
4. Inline `[1]`, `[2]`, `[3]` red badges land as the model cites sources.
5. When the stream finishes, a small `⚡ 1.8s · 3 sources` row appears under the answer.
6. Clicking any `[n]` slides in the **Source panel** on the right showing the exact passage and a "View on canada.ca" link. Clicking the same `[n]` chip again on a different answer swaps the panel content.

Edge cases you can test:

- **Refuse path** — `What's the mortgage interest rate in Canada?` → amber "Not in my sources" bubble with no citations.
- **Empty corpus question** — `Can IRCC find me a job?` → also refuse.
- **New chat** — sidebar button clears everything.
- **Autoscroll politeness** — scroll up while the stream is going; new tokens won't yank you back down. Scroll near the bottom again to re-pin.

---

## States, summarised

| Status | UI |
|---|---|
| `idle` | Composer ready, empty state if no messages |
| `submitting` | Composer disabled, "Working on the previous question…" placeholder |
| `tool_running` | ToolActivity pill visible under the latest bubbles |
| `streaming` | Tokens appearing live in the assistant bubble with a blinking cursor |
| `done` | Latency badge + citation count appear under the bubble |
| `refused` | Amber "Not in my sources" bubble |
| `error` | Red banner above composer with the message |

---

## What's NOT here (deliberately)

- No login, no user accounts — this is a public information tool.
- No persistence — the backend is stateless and so is the frontend session. New tab = new conversation.
- No "Like / Dislike" feedback buttons (would need a backend table; out of scope).
- No dark mode toggle (light mode reads more like a government information tool — keeping it).
- No "Stop generating" button — turn-level abort exists in the hook (`abort()`), just no UI for it. Easy to add later.

---

## If something breaks

| Symptom | Likely cause | Fix |
|---|---|---|
| Sidebar shows "API unreachable" | Backend not running, or wrong `NEXT_PUBLIC_API_URL` | Start backend on `:8080` or update `.env.local` |
| Stream never starts | CORS blocking; check the browser console | Backend `CORS_ORIGIN` should match where you're loading the frontend from |
| Citations don't appear | The model didn't cite — happens if your corpus is thin | Ingest more docs or try a question the corpus clearly covers |
| `[1]` shows as plain text instead of a chip | An event other than `citation` carried the id, or the id was never emitted | Open Network tab in DevTools, find the `/api/chat` SSE response, scan for `event: citation` lines |
