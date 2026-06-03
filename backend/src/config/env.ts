// Zod-validated env loader. Crash early at startup if anything is missing — much
// nicer than discovering an undefined OPENAI_API_KEY 10 seconds into a request.

import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY required"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  CHAT_MODEL: z.string().default("gpt-4o-mini"),
  TAVILY_API_KEY: z.string().optional(),
  RETRIEVAL_K: z.coerce.number().int().positive().default(8),
  REFUSE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),
  MAX_TOOL_CALLS: z.coerce.number().int().positive().default(4),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
