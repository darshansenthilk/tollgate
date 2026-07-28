import { NextResponse } from "next/server";
import { PROXY_URL } from "@/lib/api";
import { buildTestRequest } from "@/lib/agent-connect";

/**
 * Server-side relay for the dashboard's "Test connection" button. The proxy
 * (backend/proxy/src/index.ts) is deliberately not CORS-enabled — it's a
 * server-to-server data plane, agents call it directly with a token, no
 * browser is meant to hit it cross-origin. Running this fetch here (a Next.js
 * route handler, server-side) instead of client-side sidesteps that: it's a
 * same-origin call from the dashboard's own server to the proxy, which browser
 * CORS never governs. This adds no new capability beyond what the token
 * already grants — anyone holding a valid token could make this exact call
 * directly against the proxy.
 */

/** Tollgate's own gate rejections (registerProxyRoute) — a real upstream
 *  error (a genuine OpenAI/Anthropic 4xx/5xx) won't match one of these
 *  codes, and falls through to the raw-status branch below instead. */
const GATE_MESSAGES: Record<string, string> = {
  missing_token: "No token was sent.",
  invalid_token: "That token doesn't match any agent — check it was copied correctly.",
  provider_mismatch: "This token's assistant doesn't match the request's provider.",
  agent_frozen: "This agent is currently frozen — unfreeze it to send real requests.",
  budget_exceeded: "This agent's budget is already used up.",
  unknown_provider: "Unknown provider.",
  upstream_key_unavailable: "Tollgate has no upstream key configured for this provider yet.",
};

export async function POST(req: Request): Promise<NextResponse> {
  const raw: unknown = await req.json().catch(() => null);
  const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const providerSlug = rec?.["providerSlug"];
  const token = rec?.["token"];
  const model = rec?.["model"];
  if (
    typeof providerSlug !== "string" ||
    typeof token !== "string" ||
    (model !== null && typeof model !== "string")
  ) {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const testRequest = buildTestRequest(providerSlug, model);
  if (testRequest === null) {
    return NextResponse.json({ ok: false, message: "Unsupported assistant or model." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${PROXY_URL}${testRequest.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(testRequest.body),
    });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Couldn't reach the Tollgate proxy. Is it deployed and reachable?" },
      { status: 200 },
    );
  }

  const text = await upstream.text();
  if (upstream.ok) {
    return NextResponse.json({
      ok: true,
      message: "Success — the request was forwarded and a real response came back.",
    });
  }

  let parsed: unknown = null;
  try {
    parsed = text.trim() === "" ? null : JSON.parse(text);
  } catch {
    // Non-JSON upstream body — fall through, code stays null.
  }
  const code =
    typeof parsed === "object" && parsed !== null && typeof (parsed as Record<string, unknown>)["error"] === "string"
      ? ((parsed as Record<string, unknown>)["error"] as string)
      : null;

  const message =
    (code !== null ? GATE_MESSAGES[code] : undefined) ??
    `The provider rejected the request (${upstream.status}): ${text.slice(0, 200)}`;

  return NextResponse.json({ ok: false, message });
}
