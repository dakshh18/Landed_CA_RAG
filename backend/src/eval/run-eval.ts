// =============================================================================
// EVAL HARNESS — what separates a portfolio project from a tutorial.
// =============================================================================
// We measure four things on a fixed "gold" set of questions:
//
//   1) recall@k — for ANSWERABLE questions, did at least one retrieved chunk
//      contain ALL the expected substrings (e.g. "Comprehensive Ranking
//      System", "points")? This tests retrieval in isolation.
//
//   2) faithfulness — is every claim in the answer supported by retrieved
//      context? LLM-as-judge: we ask gpt-4o-mini "given this context, are all
//      claims supported? yes/no". Hallucinations = unfaithful.
//
//   3) relevance — does the answer actually address the question? Same
//      LLM-as-judge pattern. A faithful-but-off-topic answer fails this.
//
//   4) refusal accuracy — for UNANSWERABLE questions, did the agent correctly
//      refuse? For answerable ones, did it correctly NOT refuse?
//
// We also accept CLI flags to A/B retrieval mode (hybrid vs vector), so you
// can run:
//     npm run eval                       # default: hybrid
//     npm run eval -- --mode vector      # vector-only for comparison
// Combine with re-ingesting under --strategy fixed | semantic to get the full
// 2x2 comparison table the BACKEND spec asks for.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { env } from "../config/env";
import { runAgent } from "../agent/orchestrator";
import { retrieveDocs, RetrievalMode } from "../retrieval/hybrid";
import { pool } from "../db/pool";

const judge = new OpenAI({ apiKey: env.OPENAI_API_KEY });

interface GoldItem {
  q: string;
  answer_contains: string[];
  answerable: boolean;
}

interface ItemResult {
  q: string;
  answerable: boolean;
  recallHit: boolean | null;   // null when no expected substrings to check
  refused: boolean;
  refusalCorrect: boolean;
  faithful: boolean | null;    // null when refused
  relevant: boolean | null;
  toolCalls: number;
  latencyMs: number;
}

function parseArgs(): { mode: RetrievalMode; limit?: number } {
  const args = process.argv.slice(2);
  const modeIdx = args.indexOf("--mode");
  const mode = (modeIdx >= 0 ? args[modeIdx + 1] : "hybrid") as RetrievalMode;
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : undefined;
  if (mode !== "hybrid" && mode !== "vector") {
    console.error(`unknown --mode ${mode}`);
    process.exit(1);
  }
  return { mode, limit };
}

async function recallAtK(item: GoldItem, mode: RetrievalMode): Promise<boolean | null> {
  // Recall is only meaningful when we have expected-substring hints. For items
  // with no `answer_contains`, return null (excluded from the metric).
  if (item.answer_contains.length === 0) return null;
  const chunks = await retrieveDocs(item.q, env.RETRIEVAL_K, mode);
  const haystack = chunks.map((c) => c.content.toLowerCase()).join("\n\n");
  return item.answer_contains.every((s) => haystack.includes(s.toLowerCase()));
}

async function llmJudge(prompt: string): Promise<boolean> {
  // LLM-as-judge: we want a single yes/no. Force a short answer and parse.
  const res = await judge.chat.completions.create({
    model: env.CHAT_MODEL,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          'You are a strict evaluator. Answer with exactly one word: "yes" or "no".',
      },
      { role: "user", content: prompt },
    ],
  });
  const out = (res.choices[0]?.message.content ?? "").trim().toLowerCase();
  return out.startsWith("y");
}

async function judgeFaithful(question: string, answer: string, context: string): Promise<boolean> {
  return llmJudge(
    `Question: ${question}\n\nContext (the only allowed source):\n${context}\n\n` +
      `Candidate answer:\n${answer}\n\n` +
      `Is every factual claim in the candidate answer directly supported by the context? Answer "yes" or "no".`
  );
}

async function judgeRelevant(question: string, answer: string): Promise<boolean> {
  return llmJudge(
    `Question: ${question}\n\nCandidate answer:\n${answer}\n\n` +
      `Does the candidate answer directly address the question? Answer "yes" or "no".`
  );
}

function formatTable(results: ItemResult[]): string {
  const cell = (s: string, w: number) => s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
  const lines: string[] = [];
  lines.push(
    cell("question", 60) +
      cell("answerable", 11) +
      cell("recall", 7) +
      cell("refused", 8) +
      cell("refuseOK", 9) +
      cell("faith", 6) +
      cell("relev", 6)
  );
  lines.push("-".repeat(107));
  for (const r of results) {
    lines.push(
      cell(r.q, 60) +
        cell(r.answerable ? "yes" : "no", 11) +
        cell(r.recallHit == null ? "-" : r.recallHit ? "✓" : "✗", 7) +
        cell(r.refused ? "yes" : "no", 8) +
        cell(r.refusalCorrect ? "✓" : "✗", 9) +
        cell(r.faithful == null ? "-" : r.faithful ? "✓" : "✗", 6) +
        cell(r.relevant == null ? "-" : r.relevant ? "✓" : "✗", 6)
    );
  }
  return lines.join("\n");
}

function summarise(results: ItemResult[]) {
  const recallable = results.filter((r) => r.recallHit !== null);
  const recallRate = recallable.length
    ? recallable.filter((r) => r.recallHit).length / recallable.length
    : 0;

  const answered = results.filter((r) => !r.refused);
  const faithful = answered.filter((r) => r.faithful);
  const relevant = answered.filter((r) => r.relevant);

  const refusalRate = results.filter((r) => r.refusalCorrect).length / results.length;

  const avgLatency =
    results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, results.length);
  const avgToolCalls =
    results.reduce((s, r) => s + r.toolCalls, 0) / Math.max(1, results.length);

  return {
    recallRate,
    faithfulnessRate: answered.length ? faithful.length / answered.length : 0,
    relevanceRate: answered.length ? relevant.length / answered.length : 0,
    refusalAccuracy: refusalRate,
    avgLatencyMs: Math.round(avgLatency),
    avgToolCalls: Number(avgToolCalls.toFixed(2)),
    answeredCount: answered.length,
    totalCount: results.length,
  };
}

async function main() {
  const { mode, limit } = parseArgs();
  const goldPath = path.join(__dirname, "gold.json");
  const gold: GoldItem[] = JSON.parse(fs.readFileSync(goldPath, "utf8"));
  const items = limit ? gold.slice(0, limit) : gold;

  console.log(`Running eval on ${items.length} question(s)  (retrieval mode: ${mode})\n`);

  const results: ItemResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    process.stdout.write(`[${i + 1}/${items.length}] ${item.q.slice(0, 70)}... `);

    // 1) recall@k — isolated retrieval check
    const recallHit = await recallAtK(item, mode);

    // 2) full agent run (no streaming callback; we want the result object)
    const agentResult = await runAgent({ messages: [{ role: "user", content: item.q }] });

    const refused = agentResult.refused;
    const refusalCorrect = refused === !item.answerable;

    // 3) faithfulness + relevance — only on non-refusal answers
    let faithful: boolean | null = null;
    let relevant: boolean | null = null;
    if (!refused && agentResult.answer) {
      const context = agentResult.citations
        .map((c) => `[${c.id}] ${c.title} (${c.source}):\n${c.passage}`)
        .join("\n\n");
      faithful = context ? await judgeFaithful(item.q, agentResult.answer, context) : false;
      relevant = await judgeRelevant(item.q, agentResult.answer);
    }

    results.push({
      q: item.q,
      answerable: item.answerable,
      recallHit,
      refused,
      refusalCorrect,
      faithful,
      relevant,
      toolCalls: agentResult.toolCalls,
      latencyMs: agentResult.latencyMs,
    });
    console.log(`done (${agentResult.latencyMs}ms, ${agentResult.toolCalls} tool calls, ${refused ? "refused" : "answered"})`);
  }

  console.log("\n" + formatTable(results) + "\n");
  const s = summarise(results);
  console.log("=== Summary ===");
  console.log(`mode:              ${mode}`);
  console.log(`recall@k:          ${(s.recallRate * 100).toFixed(1)}%`);
  console.log(`faithfulness:      ${(s.faithfulnessRate * 100).toFixed(1)}%  (of ${s.answeredCount} answers)`);
  console.log(`relevance:         ${(s.relevanceRate * 100).toFixed(1)}%`);
  console.log(`refusal accuracy:  ${(s.refusalAccuracy * 100).toFixed(1)}%`);
  console.log(`avg latency:       ${s.avgLatencyMs}ms`);
  console.log(`avg tool calls:    ${s.avgToolCalls}`);

  // Persist the run to a CSV-ish file you can copy into your README.
  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `eval-${mode}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ mode, results, summary: s }, null, 2));
  console.log(`\nwrote ${outFile}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
