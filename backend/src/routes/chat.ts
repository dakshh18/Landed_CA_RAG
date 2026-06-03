// =============================================================================
// POST /api/chat  — Server-Sent Events stream of the agent's response.
// =============================================================================
// SSE = a one-way HTTP stream where the server writes lines like:
//
//   event: token
//   data: {"text":"Hello"}
//
// (blank line between frames). Browsers (and our useChatStream hook) parse
// these natively — much simpler than WebSockets for a one-way token stream.
//
// Events we emit (see orchestrator AgentEvent):
//   tool      — a tool started or finished
//   token     — one delta of assistant text
//   citation  — metadata for an inline [n] marker the model used
//   refuse    — the agent refused; no answer follows
//   done      — stream complete; latency + tool-call count
//   error     — unexpected failure (rare; usually the stream just ends)
// =============================================================================

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { runAgent } from "../agent/orchestrator";

export const chatRouter = Router();

// Per-IP rate limit on the expensive endpoint (LLM calls cost money).
const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const ChatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
  lang: z.enum(["en", "fr"]).optional(),
});

chatRouter.post("/", chatLimiter, async (req: Request, res: Response) => {
  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }

  // -- Open the SSE stream ---------------------------------------------------
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering in prod
  res.flushHeaders();

  const send = (eventName: string, data: unknown) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // If the client disconnects mid-stream, abort gracefully.
  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });

  try {
    await runAgent(parsed.data, (e) => {
      if (clientClosed) return;
      send(e.event, e.data);
    });
  } catch (err) {
    console.error("agent error:", err);
    if (!clientClosed) {
      send("error", { message: "internal_error" });
    }
  } finally {
    if (!clientClosed) res.end();
  }
});
