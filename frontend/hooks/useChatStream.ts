"use client";

// =============================================================================
// useChatStream — the brain of the chat UI.
// =============================================================================
// Talks to POST /api/chat, parses the SSE stream the backend emits, and keeps
// the message list + transient turn state in React state.
//
// Why a custom hook instead of TanStack Query? Query is built for snapshots
// (one request, one response). Streams need incremental updates — tokens
// arriving one at a time, citations appearing mid-answer. A small state
// machine fits better.
//
// State machine:
//
//   idle ──send()──► submitting ──first tool event──► tool_running ──┐
//                                                                    │
//                                       token events                 │
//                                  ◄──────────────────────────┐      │
//                                                             │      ▼
//                              streaming ◄───first token─────┴── (any state)
//                                  │
//                                  ├── refuse event ─► refused
//                                  ├── done event   ─► done
//                                  └── error/throw  ─► error
// =============================================================================

import { useCallback, useRef, useState } from "react";
import { API_URL } from "@/lib/api";
import type {
  ChatMessage,
  Citation,
  StreamStatus,
  ToolEvent,
} from "@/lib/types";

interface UseChatStreamResult {
  messages: ChatMessage[];
  status: StreamStatus;
  currentTool: ToolEvent | null;   // what tool is firing right now (for the pill)
  errorMessage: string | null;
  send: (text: string) => Promise<void>;
  reset: () => void;
  abort: () => void;
}

export function useChatStream(): UseChatStreamResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [currentTool, setCurrentTool] = useState<ToolEvent | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // AbortController so a second send() (or reset) can cancel an in-flight stream.
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setStatus("idle");
    setCurrentTool(null);
    setErrorMessage(null);
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Cancel any prior in-flight stream.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Optimistic: push the user message + an empty assistant placeholder.
      // We mutate the placeholder in place as tokens stream in.
      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const asstPlaceholder: ChatMessage = {
        role: "assistant",
        content: "",
        citations: [],
      };
      setStatus("submitting");
      setErrorMessage(null);
      setCurrentTool(null);

      // Build the next message list (this is also what we send to the API).
      const nextMessages = [...messages, userMsg, asstPlaceholder];
      setMessages(nextMessages);

      // The backend is stateless — send the whole conversation each turn.
      const apiPayload = {
        messages: nextMessages
          .filter((m) => !(m.role === "assistant" && m.content === ""))
          .map((m) => ({ role: m.role, content: m.content })),
      };

      try {
        const res = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(apiPayload),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
        }

        // -- SSE parser --------------------------------------------------------
        // Frames are separated by a blank line; within a frame, lines look
        // like `event: <name>` and `data: <json>`. Read raw bytes, decode,
        // split on \n\n, and dispatch each frame.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let frameEnd: number;
          while ((frameEnd = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            handleFrame(frame);
          }
        }

        // If the loop ended without a `done` event we still want to mark idle.
        setStatus((s) => (s === "done" || s === "refused" || s === "error" ? s : "done"));
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // Caller aborted — silent.
          return;
        }
        console.error("chat stream error:", err);
        setStatus("error");
        setErrorMessage(err?.message ?? "Stream failed");
      } finally {
        setCurrentTool(null);
        if (abortRef.current === ctrl) abortRef.current = null;
      }

      // -- SSE frame dispatch ----------------------------------------------
      function handleFrame(frame: string) {
        let event = "message";
        let dataStr = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        let data: any;
        try {
          data = JSON.parse(dataStr);
        } catch {
          data = dataStr;
        }

        switch (event) {
          case "tool":
            setCurrentTool(data.status === "running" ? data : null);
            setStatus((s) => (s === "streaming" ? s : "tool_running"));
            break;

          case "token":
            setStatus("streaming");
            // Append to the last assistant message.
            setMessages((prev) => {
              const out = prev.slice();
              const last = out[out.length - 1];
              if (last && last.role === "assistant") {
                out[out.length - 1] = { ...last, content: last.content + (data.text ?? "") };
              }
              return out;
            });
            break;

          case "citation":
            setMessages((prev) => {
              const out = prev.slice();
              const last = out[out.length - 1];
              if (last && last.role === "assistant") {
                const existing = last.citations ?? [];
                // Dedupe by id in case the backend ever emits twice.
                if (!existing.find((c) => c.id === data.id)) {
                  out[out.length - 1] = {
                    ...last,
                    citations: [...existing, data as Citation],
                  };
                }
              }
              return out;
            });
            break;

          case "refuse":
            setStatus("refused");
            setMessages((prev) => {
              const out = prev.slice();
              const last = out[out.length - 1];
              if (last && last.role === "assistant") {
                out[out.length - 1] = {
                  ...last,
                  refused: true,
                  refuseReason: data.reason,
                  content: "", // refusal has no body
                };
              }
              return out;
            });
            break;

          case "done":
            setMessages((prev) => {
              const out = prev.slice();
              const last = out[out.length - 1];
              if (last && last.role === "assistant") {
                out[out.length - 1] = { ...last, latencyMs: data.latencyMs };
              }
              return out;
            });
            setStatus((s) => (s === "refused" ? s : "done"));
            setCurrentTool(null);
            break;

          case "error":
            setStatus("error");
            setErrorMessage(data?.message ?? "Server error");
            break;
        }
      }
    },
    [messages]
  );

  return { messages, status, currentTool, errorMessage, send, reset, abort };
}
