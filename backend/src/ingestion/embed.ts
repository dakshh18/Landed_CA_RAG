// =============================================================================
// EMBEDDINGS — turning text into a vector of numbers.
// =============================================================================
// An "embedding" is a fixed-length array of floats (here: 1536 numbers) that
// represents the *meaning* of a piece of text. Texts about similar things land
// near each other in that 1536-D space — that's what makes "semantic search"
// possible. We store embeddings in Postgres via the `pgvector` extension and
// query for nearest neighbours at request time.
//
// `text-embedding-3-small`: cheap (~$0.02 / 1M tokens), strong, 1536 dims.
// =============================================================================

import OpenAI from "openai";
import { env } from "../config/env";

const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/**
 * Embed a batch of strings in one API call. OpenAI accepts up to ~2048 inputs
 * per request; we cap at 100 to keep memory and retry cost reasonable.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 100) {
    throw new Error(`embedBatch: max 100 inputs per call, got ${texts.length}`);
  }
  const res = await client.embeddings.create({
    model: env.EMBEDDING_MODEL,
    input: texts,
  });
  // OpenAI returns objects in the same order as the input — verified by `index`.
  return res.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/** Convenience: embed many strings, batching under the hood. */
export async function embedAll(texts: string[], batchSize = 100): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vecs = await embedBatch(batch);
    out.push(...vecs);
    console.log(`  embedded ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
  }
  return out;
}

/**
 * pgvector accepts vectors as a string like '[0.1, 0.2, ...]'. We could rely
 * on a driver helper but doing it explicitly keeps the path obvious.
 */
export function toPgVector(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}
