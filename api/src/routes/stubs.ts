import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * Management-plane route skeleton. Every handler returns 501 for now —
 * this milestone only proves the services boot and reach Redis/Postgres.
 *
 * Planned shape (from the design docs):
 *   Agents:   GET/POST /v1/agents, GET/PATCH/DELETE /v1/agents/:id
 *   Freeze:   POST /v1/agents/:id/freeze   { mode: "soft" | "hard" }
 *             POST /v1/agents/:id/unfreeze
 *   Policies: GET/POST /v1/policies, GET/PATCH/DELETE /v1/policies/:id
 */
export function registerStubRoutes(app: FastifyInstance) {
  const notImplemented =
    (feature: string) => async (_req: unknown, reply: FastifyReply) => {
      reply.code(501);
      return { error: "not_implemented", feature };
    };

  app.get("/v1/agents", notImplemented("list agents"));
  app.post("/v1/agents", notImplemented("create agent"));
  app.get("/v1/agents/:id", notImplemented("get agent"));
  app.patch("/v1/agents/:id", notImplemented("update agent"));
  app.delete("/v1/agents/:id", notImplemented("archive agent"));

  app.post("/v1/agents/:id/freeze", notImplemented("freeze agent"));
  app.post("/v1/agents/:id/unfreeze", notImplemented("unfreeze agent"));

  app.get("/v1/policies", notImplemented("list policies"));
  app.post("/v1/policies", notImplemented("create policy"));
  app.get("/v1/policies/:id", notImplemented("get policy"));
  app.patch("/v1/policies/:id", notImplemented("update policy"));
  app.delete("/v1/policies/:id", notImplemented("delete policy"));
}
