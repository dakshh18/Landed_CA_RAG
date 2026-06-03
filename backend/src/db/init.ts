// `pnpm db:init` — applies schema.sql to the configured database.
import fs from "node:fs";
import path from "node:path";
import { pool } from "./pool";

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  console.log("Applying schema.sql ...");
  await pool.query(sql);
  console.log("Schema applied. Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
