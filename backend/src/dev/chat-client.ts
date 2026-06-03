// Tiny dev client for /api/chat. Sends a single question and prints the SSE
// stream as it arrives — no curl, no PowerShell quoting hell.
//
//   npm run chat -- "How is a candidate ranked in Express Entry?"
//
// Tokens print inline; tool/citation/refuse/done events print on their own
// lines so you can see the agent's behaviour without setting up the frontend.

const url = process.env.API_URL ?? "http://localhost:8080/api/chat";

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error('Usage: npm run chat -- "your question"');
    process.exit(1);
  }

  console.log(`\n→ ${question}\n`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  // SSE parser: frames are separated by a blank line; each frame has
  // `event: <name>` and `data: <json>` lines.
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
  console.log("\n");
}

function handleFrame(frame: string) {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  let parsed: any;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = data;
  }

  switch (event) {
    case "tool":
      process.stdout.write(`\n[tool: ${parsed.name} ${parsed.status}${parsed.query ? ` "${parsed.query}"` : ""}]\n`);
      break;
    case "token":
      process.stdout.write(parsed.text ?? "");
      break;
    case "citation":
      process.stdout.write(`\n  [${parsed.id}] ${parsed.title}${parsed.page ? ` p.${parsed.page}` : ""} (${parsed.source})\n      ${parsed.url ?? ""}\n`);
      break;
    case "refuse":
      process.stdout.write(`\n[refused: ${parsed.reason}]\n`);
      break;
    case "done":
      process.stdout.write(`\n[done: ${parsed.latencyMs}ms, ${parsed.toolCalls} tool call(s), refused=${parsed.refused}]\n`);
      break;
    case "error":
      console.error(`\n[error: ${parsed.message}]`);
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
