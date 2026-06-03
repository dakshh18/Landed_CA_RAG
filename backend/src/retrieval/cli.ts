// `pnpm retrieve "your question"` — quick sanity check for retrieval quality
// before plugging the agent on top of it.
import { pool } from "../db/pool";
import { retrieveDocs } from "./hybrid";

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('Usage: pnpm retrieve "your question here"');
    process.exit(1);
  }
  const results = await retrieveDocs(query, 8);
  console.log(`\nTop ${results.length} chunks for: "${query}"\n`);
  for (const r of results) {
    console.log(`  [score=${r.score.toFixed(4)}] ${r.document_title} (p.${r.page})`);
    console.log(`    ${r.content.slice(0, 180).replace(/\s+/g, " ")}...`);
    console.log();
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
