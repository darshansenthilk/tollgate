// Reads a proxied chat-completions response body from stdin and prints a
// one-line cost summary, using the same price table as
// proxy/src/adapters/openai.ts (gpt-4o-mini: 15c/60c per 1M in/out tokens).
// Terminal-only convenience — the dashboard's own number (read from Redis via
// GET /v1/agents) is the authoritative spend total, this just mirrors it live
// in the terminal without waiting on the 3s poll.
let data = "";
process.stdin.on("data", (chunk) => (data += chunk));
process.stdin.on("end", () => {
  let body;
  try {
    body = JSON.parse(data);
  } catch {
    console.log("(could not parse upstream response body)");
    return;
  }

  const usage = body.usage;
  if (usage && typeof usage.prompt_tokens === "number") {
    const costCents = (usage.prompt_tokens * 15 + usage.completion_tokens * 60) / 1e6;
    console.log(
      `usage ${usage.prompt_tokens}+${usage.completion_tokens} tok -> ~${costCents.toFixed(4)}c this call`,
    );
    return;
  }

  if (body.error) {
    const code = body.error.code ?? body.error.message ?? "unknown";
    console.log(`no usage data (upstream error: ${code}) -> $0 metered`);
    return;
  }

  console.log("no usage data -> $0 metered");
});
