import type { FastifyInstance } from "fastify";
import {
  LocalLlmUnavailableError,
  ollamaLocalLlm,
  type AgentDraft,
  type LocalLlm,
} from "../lib/local-llm.js";

/**
 * Drafts an agent's configuration from a plain-English description, using the
 * customer's own local model (see lib/local-llm.ts for why it's local).
 *
 * DRAFTS, NEVER CREATES. This route touches no table. It returns values the
 * create-agent dialog pre-fills, and the operator still reviews them and hits
 * Create — which goes through POST /v1/agents and its existing validation like
 * any hand-typed agent. That split is deliberate: a model that misreads
 * "never let it issue refunds" as a budget rather than a blocked tool produces
 * a wrong FORM, not a wrong agent, and the person who asked for it is looking
 * right at it.
 *
 * Injected so tests can drive the route without a model running — same shape
 * as the proxy's ProxyDeps, for the same reason.
 */

/** Long enough to describe an agent properly, short enough that the request
 *  body isn't a place to paste a document. */
const DESCRIPTION_MAX = 2_000;

export interface AgentDraftDeps {
  llm: LocalLlm;
}

function parseBody(body: unknown): { description: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const description = (body as Record<string, unknown>)["description"];
  if (typeof description !== "string") return null;
  const trimmed = description.trim();
  if (trimmed === "" || trimmed.length > DESCRIPTION_MAX) return null;
  return { description: trimmed };
}

export function registerAgentDraftRoutes(
  app: FastifyInstance,
  deps: AgentDraftDeps = { llm: ollamaLocalLlm() },
): void {
  /**
   * Whether to offer the feature at all. A self-hosted deployment that never
   * starts the optional Ollama service is the expected case, not an error —
   * the dashboard hides the wizard rather than showing a button that always
   * fails.
   */
  app.get("/v1/agents/draft/availability", async () => {
    return { available: await deps.llm.isAvailable() };
  });

  app.post<{ Body: unknown }>("/v1/agents/draft", async (req, reply) => {
    const body = parseBody(req.body);
    if (body === null) {
      reply.code(400);
      return { error: "invalid_body" };
    }

    let draft: AgentDraft;
    try {
      draft = await deps.llm.draftAgent(body.description);
    } catch (err) {
      if (err instanceof LocalLlmUnavailableError) {
        // 503, not 500: nothing is broken in Tollgate — the optional sidecar
        // this feature depends on isn't answering, and the message says what
        // to do about it.
        reply.code(503);
        return { error: "local_llm_unavailable", message: err.message };
      }
      throw err;
    }

    return draft;
  });
}
