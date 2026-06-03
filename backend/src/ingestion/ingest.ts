// =============================================================================
// INGEST CLI: `pnpm ingest ./corpus`
// =============================================================================
// Walk a folder of PDFs, for each one:
//   1) parse pages with pdf-parse
//   2) chunk (fixed | semantic) — pick via --strategy flag
//   3) embed the chunks in batches
//   4) upsert into Postgres (idempotent on file_name)
//
// Sidecar JSON (same base name as the PDF) can override metadata:
//   { "title": "...", "source_url": "...", "lang": "en", "fetched_at": "2026-05-20" }
// If absent, we fall back to the file name and today's date.
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import pdfParse from "pdf-parse";
import { pool } from "../db/pool";
import { chunkPages, ChunkingStrategy, RawPage } from "./chunk";
import { embedAll, toPgVector } from "./embed";

interface DocMeta {
  title?: string;
  source_url?: string;
  lang?: string;
  fetched_at?: string; // YYYY-MM-DD
}

interface CliArgs {
  corpusDir: string;
  strategy: ChunkingStrategy;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: pnpm ingest <corpus-dir> [--strategy fixed|semantic]");
    process.exit(1);
  }
  const corpusDir = path.resolve(args[0]!);
  const stratIdx = args.indexOf("--strategy");
  const strategy = (stratIdx >= 0 ? args[stratIdx + 1] : "fixed") as ChunkingStrategy;
  if (strategy !== "fixed" && strategy !== "semantic") {
    console.error(`Unknown strategy "${strategy}". Use fixed or semantic.`);
    process.exit(1);
  }
  return { corpusDir, strategy };
}

async function readPdfPages(filePath: string): Promise<RawPage[]> {
  const buf = fs.readFileSync(filePath);
  const pages: RawPage[] = [];
  // pdf-parse exposes a per-page hook via `pagerender`. Default render joins
  // text items by space, which is fine for our cleaning step.
  await pdfParse(buf, {
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((it: any) => it.str).join(" ");
      pages.push({ page: pages.length + 1, text });
      return text;
    },
  });
  return pages;
}

function readSidecarMeta(pdfPath: string): DocMeta {
  const sidecar = pdfPath.replace(/\.pdf$/i, ".json");
  if (!fs.existsSync(sidecar)) return {};
  try {
    return JSON.parse(fs.readFileSync(sidecar, "utf8")) as DocMeta;
  } catch (e) {
    console.warn(`  ! couldn't parse sidecar ${sidecar}, ignoring`);
    return {};
  }
}

async function upsertDocument(meta: Required<Pick<DocMeta, "title">> & DocMeta & { file_name: string }) {
  // Idempotency: ON CONFLICT (file_name) DO UPDATE so re-runs replace cleanly.
  // ON CASCADE delete in `chunks` means we can wipe + reinsert chunks safely.
  const res = await pool.query<{ id: number }>(
    `INSERT INTO documents (title, source_url, lang, file_name, fetched_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (file_name) DO UPDATE SET
       title = EXCLUDED.title,
       source_url = EXCLUDED.source_url,
       lang = EXCLUDED.lang,
       fetched_at = EXCLUDED.fetched_at
     RETURNING id`,
    [meta.title, meta.source_url ?? null, meta.lang ?? "en", meta.file_name, meta.fetched_at ?? null]
  );
  return res.rows[0]!.id;
}

async function ingestFile(filePath: string, strategy: ChunkingStrategy) {
  const fileName = path.basename(filePath);
  console.log(`\n→ ${fileName}`);

  const meta = readSidecarMeta(filePath);
  const title = meta.title ?? fileName.replace(/\.pdf$/i, "");
  const fetchedAt = meta.fetched_at ?? new Date().toISOString().slice(0, 10);

  console.log("  parsing pages ...");
  const pages = await readPdfPages(filePath);
  console.log(`  ${pages.length} pages`);

  console.log(`  chunking (${strategy}) ...`);
  const chunks = chunkPages(pages, { strategy });
  console.log(`  ${chunks.length} chunks`);
  if (chunks.length === 0) return;

  const docId = await upsertDocument({
    title,
    source_url: meta.source_url,
    lang: meta.lang,
    fetched_at: fetchedAt,
    file_name: fileName,
  });

  // Wipe any prior chunks for this document so re-ingest is clean.
  await pool.query("DELETE FROM chunks WHERE document_id = $1", [docId]);

  console.log("  embedding ...");
  const embeddings = await embedAll(chunks.map((c) => c.content));

  console.log("  inserting ...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      await client.query(
        `INSERT INTO chunks (document_id, page, chunk_index, content, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)`,
        [docId, c.page, c.chunkIndex, c.content, toPgVector(embeddings[i]!)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  console.log(`  ✓ ${fileName}`);
}

async function main() {
  const { corpusDir, strategy } = parseArgs();
  if (!fs.existsSync(corpusDir)) {
    console.error(`Corpus dir not found: ${corpusDir}`);
    process.exit(1);
  }
  const pdfs = fs
    .readdirSync(corpusDir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(corpusDir, f));
  if (pdfs.length === 0) {
    console.error(`No PDFs in ${corpusDir}`);
    process.exit(1);
  }
  console.log(`Ingesting ${pdfs.length} document(s) from ${corpusDir} (strategy=${strategy}) ...`);
  for (const p of pdfs) await ingestFile(p, strategy);
  await pool.end();
  console.log("\nAll done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
