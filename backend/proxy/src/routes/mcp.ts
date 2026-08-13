import type { FastifyInstance } from "fastify";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AgentStatus, ApprovalStore } from "@tollgate/shared";
import type { AgentStore, AuthedAgent } from "../lib/agents.js";
import { hashToken, extractBearer } from "../lib/agents.js";
import type { Vault } from "../lib/vault.js";
import type { SpendLog } from "../lib/spend-log.js";

/**
 * The MCP half of external agent governance (see the approved plan at
 * .claude/plans/dapper-greeting-flame.md for the full design). An agent
 * hosted on a platform Tollgate can't put itself in the LLM-traffic path of
 * (Anthropic Managed Agents, Salesforce Agentforce — both confirmed real MCP
 * clients that accept a custom tool server, no code required) is instead
 * pointed at THIS route as its MCP server. Every tool call it tries to make
 * routes through here first, reusing the exact same blockedTools/approval-
 * queue mechanism routes/proxy.ts's step-8 tool gate already uses — a
 * pending request raised here shows up in the same dashboard panel and is
 * resolved through the same api route, because ApprovalStore doesn't know or
 * care which gate raised it.
 *
 * STATELESS BY DESIGN: a fresh local Server + downstream Client are built
 * PER REQUEST (StreamableHTTPServerTransport's "stateless mode" —
 * sessionIdGenerator: undefined — is explicitly meant for this: "connections
 * are managed per-request"). Simpler and correct; not optimized for
 * connection reuse across requests. Matches lib/vault.ts's own stated
 * philosophy — correctness over a few milliseconds until there's a measured
 * reason to revisit.
 */

/** Same set routes/proxy.ts denies on — a frozen/archived agent shouldn't be
 *  able to take real-world actions via MCP either; arguably this matters
 *  MORE here than for an LLM call, since a tool call is a real side effect. */
const FROZEN_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
  "archived",
]);

export interface McpGatewayDeps {
  agents: AgentStore;
  vault: Vault;
  approvals: ApprovalStore;
  spendLog: SpendLog;
  fetchImpl: typeof fetch;
}

/** Resolves which real downstream MCP server this agent's tool calls forward
 *  to, or null if nothing's configured (agent.mcpTargetKeyId unset, or the
 *  stored "mcp-downstream" credential can't be decrypted). */
async function resolveDownstream(
  deps: McpGatewayDeps,
  agent: AuthedAgent,
): Promise<{ url: URL; authToken: string | undefined } | null> {
  if (agent.mcpTargetKeyId === null) return null;
  const credential = await deps.vault.getUpstreamKey(
    agent.orgId,
    "mcp-downstream",
    agent.mcpTargetKeyId,
  );
  if (credential === null) return null;
  const serverUrl = credential.config["serverUrl"];
  if (serverUrl === undefined || serverUrl === "") return null;
  try {
    return { url: new URL(serverUrl), authToken: credential.secrets["authToken"] };
  } catch {
    return null;
  }
}

export function registerMcpGatewayRoute(app: FastifyInstance, deps: McpGatewayDeps): void {
  app.post("/mcp", async (req, reply) => {
    // 1. Authenticate exactly like the LLM proxy: Bearer token -> SHA-256 ->
    //    agent row. Same failure shapes, same status codes.
    const token = extractBearer(req.headers.authorization);
    if (token === null) {
      reply.code(401);
      return { error: "missing_token" };
    }
    const agent = await deps.agents.findByTokenHash(hashToken(token));
    if (agent === null) {
      reply.code(401);
      return { error: "invalid_token" };
    }
    if (FROZEN_STATUSES.has(agent.status)) {
      reply.code(403);
      return { error: "agent_frozen" };
    }

    const downstream = await resolveDownstream(deps, agent);
    if (downstream === null) {
      reply.code(502);
      return { error: "mcp_downstream_unavailable" };
    }

    const downstreamClient = new Client({ name: "tollgate-mcp-gateway", version: "0.1.0" });
    const downstreamTransport = new StreamableHTTPClientTransport(downstream.url, {
      requestInit: downstream.authToken
        ? { headers: { authorization: `Bearer ${downstream.authToken}` } }
        : undefined,
    });

    const server = new Server(
      { name: "tollgate-mcp-gateway", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    // Pure passthrough — Tollgate only needs tool NAMES to gate by, not
    // schemas, so the downstream server's own tools/list answer is returned
    // unchanged (see the approved plan's "tools/list is a transparent
    // passthrough" line).
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return downstreamClient.listTools();
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const blocked = agent.blockedTools?.includes(toolName) ?? false;

      if (!blocked) {
        const result = await downstreamClient.callTool(request.params);
        void deps.spendLog
          .record({
            agentId: agent.id,
            providerId: "mcp",
            endpoint: "/mcp",
            method: "tools/call",
            estimatedCostCents: null,
            // Real dollars for an externally-hosted agent come from the
            // separate usage-poller connectors (Phase 2/3), not a per-call
            // guess here — see the approved plan for why a flat per-action
            // cost was rejected.
            actualCostCents: null,
            decision: "allowed",
            model: null,
            promptTokens: null,
            completionTokens: null,
            latencyMs: null,
            upstreamStatus: null,
            prompt: JSON.stringify(request.params).slice(0, 8000),
          })
          .catch((err: unknown) => {
            req.log.error({ err }, "spend_events write failed (mcp allowed)");
          });
        return result;
      }

      // Same escalation flow as routes/proxy.ts's step 8: a standing block
      // isn't a dead end, an operator can grant a single-use pass from the
      // dashboard, and the agent's retry spends it.
      const granted = await deps.approvals.consumeGrant(agent.id, toolName);
      if (granted) {
        const result = await downstreamClient.callTool(request.params);
        void deps.spendLog
          .record({
            agentId: agent.id,
            providerId: "mcp",
            endpoint: "/mcp",
            method: "tools/call",
            estimatedCostCents: null,
            actualCostCents: null,
            decision: "approval_granted",
            model: null,
            promptTokens: null,
            completionTokens: null,
            latencyMs: null,
            upstreamStatus: null,
            prompt: JSON.stringify(request.params).slice(0, 8000),
          })
          .catch((err: unknown) => {
            req.log.error({ err }, "spend_events write failed (mcp approval_granted)");
          });
        return result;
      }

      void deps.approvals
        .requestApproval({ orgId: agent.orgId, agentId: agent.id, toolName })
        .catch((err: unknown) => {
          req.log.error({ err }, "tool_approval_requests write failed (mcp)");
        });
      void deps.spendLog
        .record({
          agentId: agent.id,
          providerId: "mcp",
          endpoint: "/mcp",
          method: "tools/call",
          estimatedCostCents: null,
          actualCostCents: null,
          decision: "denied_tool",
          model: null,
          promptTokens: null,
          completionTokens: null,
          latencyMs: null,
          upstreamStatus: null,
          prompt: JSON.stringify(request.params).slice(0, 8000),
        })
        .catch((err: unknown) => {
          req.log.error({ err }, "spend_events write failed (mcp denied_tool)");
        });

      // A tool-call-level error, not a protocol-level one — the calling
      // agent gets an intelligible reason back and can decide what to do
      // next, same as any other tool failure it might otherwise handle.
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool "${toolName}" is blocked by this agent's policy and requires operator approval. A request has been raised — try again once it's approved.`,
          },
        ],
      };
    });

    reply.hijack();
    try {
      await downstreamClient.connect(downstreamTransport);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error({ err }, "mcp gateway request failed");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 502;
        reply.raw.end();
      }
    } finally {
      await downstreamClient.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });
}
