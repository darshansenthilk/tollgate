import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * Management-plane route skeleton for what's not implemented yet.
 * Agent CRUD + freeze/unfreeze/delete now live in routes/agents.ts; policy
 * template CRUD (shared/reusable policies, distinct from the per-agent
 * policy row created in routes/agents.ts) is still a future milestone.
 *
 * Planned shape (from the design docs):
 *   Agents:   GET/PATCH /v1/agents/:id  (single-agent get/update)
 *   Policies: GET/POST /v1/policies, GET/PATCH/DELETE /v1/policies/:id
 */
export function registerStubRoutes(app: FastifyInstance) {
  const notImplemented =
    (feature: string) => async (_req: unknown, reply: FastifyReply) => {
      reply.code(501);
      return { error: "not_implemented", feature };
    };

  app.get("/v1/agents/:id", notImplemented("get agent"));
  app.patch("/v1/agents/:id", notImplemented("update agent"));

  app.get("/v1/policies", notImplemented("list policies"));
  app.post("/v1/policies", notImplemented("create policy"));
  app.get("/v1/policies/:id", notImplemented("get policy"));
  app.patch("/v1/policies/:id", notImplemented("update policy"));
  app.delete("/v1/policies/:id", notImplemented("delete policy"));
}
