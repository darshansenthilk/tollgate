import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerMcpGatewayRoute } from "../src/routes/mcp.js";
import { FakeAgentStore, FakeVault, FakeApprovalStore, FakeSpendLog } from "./helpers.js";

const AGENT_ID = "mcp-agent-1";
const TOKEN = "tollgate-mcp-test-token";
const DOWNSTREAM_TOKEN = "downstream-secret";

/**
 * Real, live, end-to-end integration tests — not mocked HTTP. Two real
 * servers (a fake downstream MCP tool server, and Tollgate's own MCP gateway
 * route) and a real @modelcontextprotocol/sdk Client driving requests into
 * the gateway exactly as Salesforce Agentforce or Anthropic Managed Agents
 * would. Hand-rolling raw JSON-RPC test requests would skip the protocol's
 * own initialize handshake and risk testing something the real spec doesn't
 * actually require — using the real Client sidesteps that entirely.
 */

let downstreamServer: HttpServer;
let downstreamUrl: string;
let downstreamCalls: { name: string; arguments: unknown }[];

beforeAll(async () => {
  downstreamCalls = [];

  // STATELESS MODE'S REAL CONTRACT (confirmed against the SDK's own source,
  // not assumed): "each request must use a fresh transport" — a stateless
  // StreamableHTTPServerTransport instance rejects a SECOND request outright
  // (internal _hasHandledRequest flag). A fresh Server + transport are built
  // PER incoming HTTP request here, matching that exactly — and matching
  // what routes/mcp.ts already does in production. An earlier version of
  // this fixture reused one transport across every request (an easy mistake
  // to make) and got mysterious, unlogged 500s as a result — this fixture
  // exists partly to pin that down as a regression test for the fixture
  // itself, not just the gateway.
  downstreamServer = createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${DOWNSTREAM_TOKEN}`) {
      res.statusCode = 401;
      res.end();
      return;
    }
    const mcpServer = new McpServer(
      { name: "fake-downstream", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: "send_email", description: "Sends a real email", inputSchema: { type: "object" } }],
    }));
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      downstreamCalls.push({ name: request.params.name, arguments: request.params.arguments });
      return { content: [{ type: "text", text: `sent: ${JSON.stringify(request.params.arguments)}` }] };
    });

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    transport.onerror = (err) => console.error("[fake-downstream] transport error", err);

    mcpServer
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((err: unknown) => {
        console.error("[fake-downstream] handleRequest threw", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end();
        }
      });
  });
  await new Promise<void>((resolve) => downstreamServer.listen(0, resolve));
  const addr = downstreamServer.address() as AddressInfo;
  downstreamUrl = `http://127.0.0.1:${addr.port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => downstreamServer.close(() => resolve()));
});

let app: FastifyInstance;
let gatewayUrl: string;
let agents: FakeAgentStore;
let vault: FakeVault;
let approvals: FakeApprovalStore;
let spendLog: FakeSpendLog;

beforeEach(async () => {
  downstreamCalls.length = 0;
  agents = new FakeAgentStore();
  vault = new FakeVault({
    secrets: { authToken: DOWNSTREAM_TOKEN },
    config: { serverUrl: downstreamUrl },
  });
  approvals = new FakeApprovalStore();
  spendLog = new FakeSpendLog();

  app = Fastify();
  registerMcpGatewayRoute(app, {
    agents,
    vault,
    approvals,
    spendLog,
    fetchImpl: fetch,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as AddressInfo;
  gatewayUrl = `http://127.0.0.1:${addr.port}/mcp`;
});

afterEach(async () => {
  await app.close();
});

async function connectedClient(token: string): Promise<McpClient> {
  const client = new McpClient({ name: "test-caller", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

describe("MCP gateway", () => {
  it("passes tools/list straight through to the real downstream server", async () => {
    agents.add(TOKEN, { id: AGENT_ID, status: "active", providerSlug: "claude", mcpTargetKeyId: "key-1" });
    const client = await connectedClient(TOKEN);

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("send_email");
    await client.close();
  });

  it("forwards an allowed tool call to the real downstream server and logs it", async () => {
    agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      providerSlug: "claude",
      mcpTargetKeyId: "key-1",
      blockedTools: ["delete_customer"], // send_email isn't on it
    });
    const client = await connectedClient(TOKEN);

    const result = await client.callTool({ name: "send_email", arguments: { to: "a@b.com" } });

    expect(downstreamCalls).toEqual([{ name: "send_email", arguments: { to: "a@b.com" } }]);
    expect((result.content as { text: string }[])[0]?.text).toContain("sent:");
    expect(spendLog.events).toHaveLength(1);
    expect(spendLog.events[0]).toMatchObject({ agentId: AGENT_ID, decision: "allowed", providerId: "mcp" });
    await client.close();
  });

  it("blocks a listed tool, raises an approval request, and never reaches the real downstream", async () => {
    agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      providerSlug: "claude",
      mcpTargetKeyId: "key-1",
      blockedTools: ["delete_customer"],
    });
    const client = await connectedClient(TOKEN);

    const result = await client.callTool({ name: "delete_customer", arguments: { id: "42" } });

    expect(downstreamCalls).toHaveLength(0); // the real action never happened
    expect(result.isError).toBe(true);
    expect(approvals.requests).toEqual([
      { orgId: "org-test", agentId: AGENT_ID, toolName: "delete_customer" },
    ]);
    expect(spendLog.events[0]).toMatchObject({ decision: "denied_tool" });
    await client.close();
  });

  it("spends a standing grant, forwards the call, and logs approval_granted", async () => {
    agents.add(TOKEN, {
      id: AGENT_ID,
      status: "active",
      providerSlug: "claude",
      mcpTargetKeyId: "key-1",
      blockedTools: ["delete_customer"],
    });
    approvals.grant(AGENT_ID, "delete_customer");
    const client = await connectedClient(TOKEN);

    const result = await client.callTool({ name: "delete_customer", arguments: { id: "42" } });

    expect(downstreamCalls).toEqual([{ name: "delete_customer", arguments: { id: "42" } }]);
    expect(result.isError).toBeUndefined();
    expect(spendLog.events[0]).toMatchObject({ decision: "approval_granted" });
    await client.close();
  });

  it("403s a frozen agent before ever contacting the downstream", async () => {
    agents.add(TOKEN, { id: AGENT_ID, status: "hard_frozen", providerSlug: "claude", mcpTargetKeyId: "key-1" });

    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "agent_frozen" });
  });

  it("401s an unknown token", async () => {
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: { authorization: "Bearer nonexistent", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("502s when the agent has no mcpTargetKeyId configured", async () => {
    agents.add(TOKEN, { id: AGENT_ID, status: "active", providerSlug: "claude" });
    const res = await fetch(gatewayUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "mcp_downstream_unavailable" });
  });
});
