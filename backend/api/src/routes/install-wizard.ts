import type { FastifyInstance } from "fastify";
import {
  InstallWizardUnavailableError,
  deepseekInstallWizardAssistant,
  type InstallWizardAssistant,
} from "../lib/install-wizard-assistant.js";

/**
 * The public half of the install wizard — see the marketing site's
 * /get-started page. PUBLIC AND UNAUTHENTICATED ON PURPOSE: a prospective
 * self-hoster reading the download steps hasn't signed up for anything yet,
 * so this can't sit behind requireAuth like everything else in index.ts's
 * gated scope. Registered directly on the root app instead, alongside
 * /health and /api/auth/*.
 *
 * Because it's public AND calls a paid third-party API with no session to
 * hold anyone accountable, the per-route rate limit below is deliberately
 * far stricter than the api's global 300/min brace — an open Ask box on the
 * internet is a standing invitation to run up someone else's bill.
 */

const QUESTION_MAX = 1_000;

export interface InstallWizardDeps {
  assistant: InstallWizardAssistant;
}

function parseBody(body: unknown): { question: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const question = (body as Record<string, unknown>)["question"];
  if (typeof question !== "string") return null;
  const trimmed = question.trim();
  if (trimmed === "" || trimmed.length > QUESTION_MAX) return null;
  return { question: trimmed };
}

export function registerInstallWizardRoutes(
  app: FastifyInstance,
  deps: InstallWizardDeps = { assistant: deepseekInstallWizardAssistant() },
): void {
  app.get("/v1/install-wizard/availability", async () => {
    return { available: deps.assistant.isAvailable() };
  });

  app.post<{ Body: unknown }>(
    "/v1/install-wizard/ask",
    {
      config: {
        // Deliberately far below the api's global 300/min: this route has no
        // session behind it and spends real money per call, so the ceiling
        // has to hold even if one visitor's browser (or a script) hammers it.
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = parseBody(req.body);
      if (body === null) {
        reply.code(400);
        return { error: "invalid_body" };
      }

      try {
        const answer = await deps.assistant.explain(body.question);
        return { answer };
      } catch (err) {
        if (err instanceof InstallWizardUnavailableError) {
          reply.code(503);
          return { error: "install_wizard_unavailable", message: err.message };
        }
        throw err;
      }
    },
  );
}
