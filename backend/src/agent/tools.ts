// =============================================================================
// TOOLS — what the LLM is allowed to call.
// =============================================================================
// "Function calling" / "tool use" is how a model takes action. We send the
// model a list of available functions (name + JSON-schema arguments). The
// model can choose to "call" one by emitting structured JSON that we execute
// server-side. The result goes back to the model and it decides what next.
//
// We expose three tools:
//
//   retrieve_docs(query)  — search OUR corpus (hybrid retrieval). Always first.
//   web_search(query)     — search the public web via Tavily. Fallback only.
//   refuse(reason)        — structured refusal when nothing supports an answer.
//
// Each tool also has a server-side handler. The orchestrator dispatches the
// model's tool calls to these handlers and feeds the results back in.
// =============================================================================

import OpenAI from "openai";
import { env } from "../config/env";
import { retrieveDocs, RetrievedChunk } from "../retrieval/hybrid";

// -- Tool schemas seen by the model ------------------------------------------
// OpenAI's tool-use API takes these definitions verbatim.
export const TOOL_DEFS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "retrieve_docs",
      description:
        "Search the official IRCC / canada.ca document corpus for passages relevant to the user's question. Always call this first.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "A focused search query (3–15 words). Use the user's terminology.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search canada.ca and the public web for current information. Use ONLY when retrieve_docs produced no relevant passages. Call at most once.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "A focused web search query." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refuse",
      description:
        "Call this when the question cannot be answered from any retrieved source, or is out of scope (predictions, personal eligibility, topics outside immigration).",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Short reason shown to the user." },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];

// -- A "citation" is the canonical record behind a [n] marker ---------------
export interface Citation {
  id: number;                  // the [n] number the model uses inline
  title: string;
  url: string | null;
  page: number | null;         // null for web results
  fetchedAt: string | null;    // ISO date; null for live web
  passage: string;             // the actual text that supports the claim
  score?: number;              // RRF score (retrieve_docs) or rank (web_search)
  source: "corpus" | "web";
}

// CitationRegistry: assigns and remembers ids across multiple tool calls so the
// model can reference any chunk it has seen with a stable [n] marker.
export class CitationRegistry {
  private byId = new Map<number, Citation>();
  private nextId = 1;

  add(partial: Omit<Citation, "id">): Citation {
    const citation: Citation = { id: this.nextId++, ...partial };
    this.byId.set(citation.id, citation);
    return citation;
  }

  get(id: number): Citation | undefined {
    return this.byId.get(id);
  }

  all(): Citation[] {
    return Array.from(this.byId.values()).sort((a, b) => a.id - b.id);
  }

  /** Best RRF score across all corpus citations so far. */
  topCorpusScore(): number {
    let best = 0;
    for (const c of this.byId.values()) {
      if (c.source === "corpus" && (c.score ?? 0) > best) best = c.score ?? 0;
    }
    return best;
  }
}

// -- retrieve_docs handler ---------------------------------------------------
export interface RetrieveResult {
  toolMessage: string;          // formatted text returned to the model
  newCitations: Citation[];     // chunks added to the registry this call
  rawChunks: RetrievedChunk[];  // the raw retrieval output (used by eval harness)
}

export async function handleRetrieveDocs(
  query: string,
  registry: CitationRegistry
): Promise<RetrieveResult> {
  const chunks = await retrieveDocs(query, env.RETRIEVAL_K);
  if (chunks.length === 0) {
    return {
      toolMessage:
        "No relevant passages found in the IRCC corpus. You may call web_search if appropriate, otherwise call refuse.",
      newCitations: [],
      rawChunks: [],
    };
  }

  const newCitations: Citation[] = [];
  for (const chunk of chunks) {
    const c = registry.add({
      title: chunk.document_title,
      url: chunk.source_url,
      page: chunk.page,
      fetchedAt: chunk.fetched_at,
      passage: chunk.content,
      score: chunk.score,
      source: "corpus",
    });
    newCitations.push(c);
  }

  // Format passages for the model — citation id, source meta, then text.
  const lines: string[] = [
    `Found ${newCitations.length} passage(s). Cite using these numbers in your answer.`,
    "",
  ];
  for (const c of newCitations) {
    lines.push(
      `[${c.id}] Source: "${c.title}"${c.page != null ? `, page ${c.page}` : ""}` +
        `${c.fetchedAt ? ` (as of ${c.fetchedAt})` : ""}`
    );
    lines.push("---");
    lines.push(c.passage.replace(/\s+/g, " ").trim());
    lines.push("");
  }

  // Hint about retrieval confidence — the orchestrator also enforces a threshold.
  const topScore = chunks[0]?.score ?? 0;
  lines.push(`(Top retrieval score: ${topScore.toFixed(3)})`);

  return { toolMessage: lines.join("\n"), newCitations, rawChunks: chunks };
}

// -- web_search handler (Tavily) ---------------------------------------------
interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export async function handleWebSearch(
  query: string,
  registry: CitationRegistry
): Promise<{ toolMessage: string; newCitations: Citation[] }> {
  if (!env.TAVILY_API_KEY || env.TAVILY_API_KEY.startsWith("tvly-replace")) {
    return {
      toolMessage:
        "web_search is unavailable (no TAVILY_API_KEY configured). Use refuse instead.",
      newCitations: [],
    };
  }

  let results: TavilyResult[] = [];
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query,
        max_results: 5,
        include_domains: ["canada.ca"], // bias toward official sources
        search_depth: "basic",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        toolMessage: `web_search failed (${res.status}): ${text.slice(0, 200)}. Consider refuse.`,
        newCitations: [],
      };
    }
    const data = (await res.json()) as { results?: TavilyResult[] };
    results = data.results ?? [];
  } catch (err) {
    return {
      toolMessage: `web_search threw: ${(err as Error).message}. Consider refuse.`,
      newCitations: [],
    };
  }

  if (results.length === 0) {
    return {
      toolMessage: "web_search returned no results. Consider refuse.",
      newCitations: [],
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const newCitations: Citation[] = results.map((r) =>
    registry.add({
      title: r.title,
      url: r.url,
      page: null,
      fetchedAt: today,
      passage: r.content,
      score: r.score,
      source: "web",
    })
  );

  const lines: string[] = [
    `Web search returned ${newCitations.length} result(s). Cite using these numbers.`,
    "",
  ];
  for (const c of newCitations) {
    lines.push(`[${c.id}] Source: "${c.title}" (web, as of ${c.fetchedAt})`);
    lines.push(`URL: ${c.url}`);
    lines.push("---");
    lines.push(c.passage.replace(/\s+/g, " ").trim());
    lines.push("");
  }

  return { toolMessage: lines.join("\n"), newCitations };
}
