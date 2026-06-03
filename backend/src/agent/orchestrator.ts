// =============================================================================
// AGENT ORCHESTRATOR — the heart of "agentic" RAG.
// =============================================================================
// Classic RAG: retrieve once, then generate. Done.
// Agentic RAG: the *model* decides when to retrieve, when to web-search, when
// to refuse — by emitting structured tool calls. We loop:
//
//   1. Send messages + tool defs to OpenAI (streaming).
//   2. As tokens arrive, forward them to the caller's onEvent callback.
//      Also accumulate any tool-call deltas the model is producing.
//   3. When the stream finishes, look at finish_reason:
//         - "tool_calls" → execute each tool, append its result as a message,
//                          go back to step 1.
//         - "stop"       → we have a final answer. Emit citation + done events.
//   4. Backstops the model cannot disable:
//        - Hard cap MAX_TOOL_CALLS to prevent runaway loops.
//        - If top corpus retrieval score < REFUSE_THRESHOLD and no web result
//          either, force the refuse path (a real interview talking point).
//
// All of this is wrapped behind a simple `runAgent(messages, onEvent?)` API
// that the SSE route and the eval harness both consume.
// =============================================================================

import OpenAI from "openai";
import { env } from "../config/env";
import { SYSTEM_PROMPT } from "./prompts";
import {
  TOOL_DEFS,
  CitationRegistry,
  Citation,
  handleRetrieveDocs,
  handleWebSearch,
} from "./tools";
import { RetrievedChunk } from "../retrieval/hybrid";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

// -- Public types ------------------------------------------------------------

export type ChatRole = "user" | "assistant";
export interface UserMessage {
  role: ChatRole;
  content: string;
}

export type AgentEvent =
  | { event: "tool"; data: { name: string; status: "running" | "done"; query?: string } }
  | { event: "token"; data: { text: string } }
  | { event: "citation"; data: Citation }
  | { event: "refuse"; data: { reason: string } }
  | { event: "done"; data: { latencyMs: number; toolCalls: number; refused: boolean } }
  | { event: "error"; data: { message: string } };

export interface AgentResult {
  answer: string;          // final assistant text (empty if refused)
  refused: boolean;
  refuseReason?: string;
  citations: Citation[];   // every source the model saw (whether referenced or not)
  referencedCitationIds: number[]; // citation ids actually used in the answer
  retrievedChunks: RetrievedChunk[]; // for the eval harness
  toolCalls: number;
  latencyMs: number;
}

export interface RunAgentInput {
  messages: UserMessage[];
  lang?: "en" | "fr";
}

// -- Internal: a function-calling message as OpenAI expects them -------------
type Msg = OpenAI.Chat.ChatCompletionMessageParam;

// -- The loop ----------------------------------------------------------------

export async function runAgent(
  input: RunAgentInput,
  onEvent?: (e: AgentEvent) => void
): Promise<AgentResult> {
  const started = Date.now();
  const emit = onEvent ?? (() => {});
  const registry = new CitationRegistry();
  const retrievedChunks: RetrievedChunk[] = [];

  let toolCalls = 0;
  let webSearched = false;

  // Build the conversation: system prompt + prior turns. Caller is stateless.
  const messages: Msg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...input.messages.map<Msg>((m) => ({ role: m.role, content: m.content })),
  ];

  let finalAnswer = "";
  let refused = false;
  let refuseReason: string | undefined;

  // Outer loop: each iteration is one model turn (stream + maybe tool calls).
  for (let turn = 0; turn < env.MAX_TOOL_CALLS + 1; turn++) {
    const stream = await client.chat.completions.create({
      model: env.CHAT_MODEL,
      messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      stream: true,
      temperature: 0.2,
    });

    // Accumulate this turn's output: assistant text + tool-call fragments.
    let assistantContent = "";
    const pendingTools: Record<
      number,
      { id: string; name: string; arguments: string }
    > = {};
    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;
      const delta = choice.delta;

      // Plain text token — stream it to the caller right away.
      if (delta?.content) {
        assistantContent += delta.content;
        emit({ event: "token", data: { text: delta.content } });
      }

      // Tool-call deltas come in fragments (OpenAI streams the JSON arguments
      // a few characters at a time). Each fragment has an `index` we use to
      // assemble it.
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index!;
          if (!pendingTools[idx]) {
            pendingTools[idx] = { id: tc.id ?? "", name: "", arguments: "" };
          }
          const p = pendingTools[idx]!;
          if (tc.id) p.id = tc.id;
          if (tc.function?.name) p.name += tc.function.name;
          if (tc.function?.arguments) p.arguments += tc.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    // Push this assistant turn back into the message history.
    const assistantMsg: Msg = {
      role: "assistant",
      content: assistantContent || null,
      tool_calls:
        Object.keys(pendingTools).length === 0
          ? undefined
          : Object.values(pendingTools).map((p) => ({
              id: p.id,
              type: "function" as const,
              function: { name: p.name, arguments: p.arguments },
            })),
    };
    messages.push(assistantMsg);

    // -- Terminal: model produced a final answer with no tool calls ----------
    if (finishReason === "stop" || Object.keys(pendingTools).length === 0) {
      finalAnswer = assistantContent;
      break;
    }

    // -- Otherwise: dispatch each tool call ----------------------------------
    const calls = Object.values(pendingTools);
    for (const call of calls) {
      toolCalls++;
      let args: any = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = {};
      }

      if (call.name === "refuse") {
        refused = true;
        refuseReason = String(args.reason ?? "Cannot answer from available sources.");
        emit({ event: "refuse", data: { reason: refuseReason } });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Refusal acknowledged.",
        });
        // Refuse short-circuits the loop.
        break;
      }

      if (call.name === "retrieve_docs") {
        const query = String(args.query ?? "").trim();
        emit({ event: "tool", data: { name: "retrieve_docs", status: "running", query } });
        const result = await handleRetrieveDocs(query, registry);
        retrievedChunks.push(...result.rawChunks);
        emit({ event: "tool", data: { name: "retrieve_docs", status: "done" } });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.toolMessage,
        });
        continue;
      }

      if (call.name === "web_search") {
        if (webSearched) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: "web_search already used this turn. Answer from what you have or refuse.",
          });
          continue;
        }
        webSearched = true;
        const query = String(args.query ?? "").trim();
        emit({ event: "tool", data: { name: "web_search", status: "running", query } });
        const result = await handleWebSearch(query, registry);
        emit({ event: "tool", data: { name: "web_search", status: "done" } });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.toolMessage,
        });
        continue;
      }

      // Unknown tool — feed back an error so the model can recover.
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: `Unknown tool "${call.name}". Use retrieve_docs, web_search, or refuse.`,
      });
    }

    if (refused) break;

    // -- Backstop: enforce the refuse threshold ------------------------------
    // If the model burned a turn on retrieve_docs and the best chunk is weak
    // AND it hasn't tried web_search, the system prompt tells it to try
    // web_search next. If it HAS tried both and scores are still weak, on the
    // next turn we tell the model explicitly that it should refuse.
    if (
      registry.topCorpusScore() < env.REFUSE_THRESHOLD &&
      webSearched &&
      !refused
    ) {
      messages.push({
        role: "system",
        content:
          "Retrieval confidence is below the threshold and web_search did not help. Call the refuse tool.",
      });
    }
  }

  // Hard backstop: if we hit MAX_TOOL_CALLS without a final answer, refuse.
  if (!finalAnswer && !refused) {
    refused = true;
    refuseReason = "I couldn't find a reliable source for this question.";
    emit({ event: "refuse", data: { reason: refuseReason } });
  }

  // -- Emit citation events for the ids the model actually referenced -------
  // Scan the final answer for [n] markers, dedupe, and emit each one so the
  // frontend can render its SourcePanel.
  const referencedIds = new Set<number>();
  if (!refused) {
    for (const m of finalAnswer.matchAll(/\[(\d+)\]/g)) {
      const id = Number(m[1]);
      if (!referencedIds.has(id) && registry.get(id)) {
        referencedIds.add(id);
        emit({ event: "citation", data: registry.get(id)! });
      }
    }
  }

  const latencyMs = Date.now() - started;
  emit({ event: "done", data: { latencyMs, toolCalls, refused } });

  return {
    answer: finalAnswer,
    refused,
    refuseReason,
    citations: registry.all(),
    referencedCitationIds: Array.from(referencedIds),
    retrievedChunks,
    toolCalls,
    latencyMs,
  };
}
