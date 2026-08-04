"use client";

import { useEffect, useRef, useState } from "react";
import {
  AZURE_PRICES,
  CLAUDE_PRICES,
  GEMINI_PRICES,
  OPENAI_PRICES,
  findModelPrice,
  type ModelPrice,
} from "@tollgate/shared";
import type { AgentDashboardActions } from "@/components/agent-dashboard";
import { applyCreated, applyDeleted, applyStatusChange, applyUpdated } from "@/lib/agent-list-updates";
import { isStopped } from "@/lib/agent-status";
import {
  ApiError,
  type AgentListItem,
  type AgentMutationResponse,
  type CreateAgentInput,
  type CreateAgentResponse,
  type UpdateAgentInput,
  type UpdateAgentResponse,
} from "@/lib/api";

const TRAFFIC_INTERVAL_MS = 650;
const LOG_LIMIT = 20;

/** The dashboard's create-agent dialog uses short slugs ("sonnet") for
 *  Claude models; the real price table (imported from @tollgate/shared, the
 *  same one adapters/claude.ts meters real traffic with) is keyed by model
 *  family. This is the one place that bridges the two. */
const CLAUDE_MODEL_SLUGS: Record<string, string> = {
  opus: "claude-3-opus",
  sonnet: "claude-3-5-sonnet",
  haiku: "claude-3-5-haiku",
};

/** Resolved through findModelPrice, exactly as the real adapters do, so the
 *  marketing demo keeps telling the truth about what Tollgate would charge —
 *  including the dated-release fallback. */
function priceForAgent(agent: AgentListItem): ModelPrice | undefined {
  if (agent.model === null) return undefined;
  if (agent.providerSlug === "chatgpt") return findModelPrice(agent.model, OPENAI_PRICES);
  if (agent.providerSlug === "claude") {
    const family = CLAUDE_MODEL_SLUGS[agent.model] ?? agent.model;
    return findModelPrice(family, CLAUDE_PRICES);
  }
  if (agent.providerSlug === "gemini") return findModelPrice(agent.model, GEMINI_PRICES);
  if (agent.providerSlug === "azure") return findModelPrice(agent.model, AZURE_PRICES);
  return undefined;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const SAMPLE_PROMPTS = [
  "Summarize the last 10 orders and flag any refund anomalies.",
  "Check inventory levels for SKU-4471 and reorder if below threshold.",
  "Draft a reply to the customer's shipping delay complaint.",
  "Pull this week's revenue by region and compare it to forecast.",
  "Deduplicate the new lead list against the CRM before import.",
];

/** Same request-body shape the real routes take — /openai/v1/chat/completions
 *  and /claude/v1/messages — so the prompt sidebar shows something a real
 *  Tollgate request would actually look like. */
function buildFakePrompt(agent: AgentListItem): string {
  const content = SAMPLE_PROMPTS[randomInt(0, SAMPLE_PROMPTS.length - 1)];
  return agent.providerSlug === "chatgpt"
    ? JSON.stringify({ model: agent.model, messages: [{ role: "user", content }] })
    : JSON.stringify({ model: agent.model, max_tokens: 1024, messages: [{ role: "user", content }] });
}

function seedAgents(): AgentListItem[] {
  return [
    {
      id: "demo-checkout-bot",
      name: "checkout-bot",
      providerSlug: "chatgpt",
      model: "gpt-4o",
      status: "active",
      maxBudgetCents: 30,
      currentMonthSpendCents: 0,
      currentMonthTokens: 0,
      currentPrompt: null,
      upstreamKeyId: null,
      systemPrompt: null,
      blockedTools: null,
      toolDefinitions: null,
    },
    {
      id: "demo-research-agent",
      name: "research-agent",
      providerSlug: "claude",
      model: "sonnet",
      status: "active",
      maxBudgetCents: 200,
      currentMonthSpendCents: 41,
      currentMonthTokens: 18_420,
      currentPrompt: null,
      upstreamKeyId: null,
      systemPrompt: null,
      blockedTools: null,
      toolDefinitions: null,
    },
    {
      id: "demo-data-scraper",
      name: "data-scraper",
      providerSlug: "chatgpt",
      model: "gpt-4o-mini",
      status: "active",
      maxBudgetCents: 50,
      currentMonthSpendCents: 46,
      currentMonthTokens: 52_310,
      currentPrompt: null,
      upstreamKeyId: null,
      systemPrompt: null,
      blockedTools: null,
      toolDefinitions: null,
    },
    {
      id: "demo-nightly-backfill",
      name: "nightly-backfill",
      providerSlug: "chatgpt",
      model: "gpt-4o",
      status: "soft_frozen",
      maxBudgetCents: 100,
      currentMonthSpendCents: 0,
      currentMonthTokens: 0,
      currentPrompt: null,
      upstreamKeyId: null,
      systemPrompt: null,
      blockedTools: null,
      toolDefinitions: null,
    },
  ];
}

export interface AgentSimulator {
  agents: AgentListItem[];
  actions: AgentDashboardActions;
  log: string[];
  running: boolean;
  runningId: string | null;
  setRunningId: (id: string | null) => void;
  toggleTraffic: () => void;
}

/**
 * Client-side stand-in for the real proxy, driving the marketing page's live
 * demo. Mirrors backend/proxy/src/routes/proxy.ts's hot path step for step —
 * freeze gate before budget gate, real routes, real cost metering from the
 * same imported price tables the real adapters meter with (see
 * priceForAgent) — so the demo tells the truth about how Tollgate actually
 * enforces, not a simplified approximation of it.
 */
export function useAgentSimulator(): AgentSimulator {
  const [agents, setAgents] = useState<AgentListItem[]>(seedAgents);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(() => seedAgents()[0]?.id ?? null);

  // The traffic interval reads this instead of `agents` directly so it always
  // sees the latest state without needing to re-subscribe (and reset its
  // 650ms cadence) every time a tick changes spend.
  const agentsRef = useRef(agents);
  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  useEffect(() => {
    if (!running || runningId === null) return;

    const interval = setInterval(() => {
      const agent = agentsRef.current.find((a) => a.id === runningId);
      if (agent === undefined) return;

      // 1. Freeze gate — before budget, exactly as proxy.ts orders its checks.
      if (isStopped(agent.status)) {
        setLog((prev) => [`403 agent_frozen ← ${agent.name}`, ...prev].slice(0, LOG_LIMIT));
        return;
      }
      // 2. Budget gate.
      if (agent.maxBudgetCents !== null && agent.currentMonthSpendCents >= agent.maxBudgetCents) {
        setLog((prev) => [`403 budget_exceeded ← ${agent.name}`, ...prev].slice(0, LOG_LIMIT));
        return;
      }

      // 3-4. Forward + meter: fake usage, real per-model pricing.
      const promptTokens = randomInt(40, 160);
      const completionTokens = randomInt(20, 80);
      const price = priceForAgent(agent);
      const costCents =
        price === undefined
          ? 0
          : (promptTokens * price.inputCentsPerMTok) / 1_000_000 +
            (completionTokens * price.outputCentsPerMTok) / 1_000_000;
      const currentPrompt = buildFakePrompt(agent);

      setAgents((prev) =>
        prev.map((a) =>
          a.id === runningId
            ? {
                ...a,
                currentPrompt,
                currentMonthSpendCents: a.currentMonthSpendCents + costCents,
                currentMonthTokens: a.currentMonthTokens + promptTokens + completionTokens,
              }
            : a,
        ),
      );
      setLog((prev) =>
        [`200 forwarded ← ${agent.name} · $${(costCents / 100).toFixed(4)}`, ...prev].slice(
          0,
          LOG_LIMIT,
        ),
      );
    }, TRAFFIC_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [running, runningId]);

  async function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
    const response: CreateAgentResponse = {
      id: `demo-${crypto.randomUUID()}`,
      name: input.name,
      providerSlug: input.providerSlug,
      model: input.model,
      status: "active",
      maxBudgetCents: input.maxBudgetCents,
      upstreamKeyId: input.upstreamKeyId ?? null,
      systemPrompt: input.systemPrompt,
      blockedTools: input.blockedTools,
      toolDefinitions: input.toolDefinitions,
      token: `tg_demo_${Math.random().toString(36).slice(2, 10)}`,
    };
    setAgents((prev) => applyCreated(prev, response));
    return response;
  }

  async function updateAgent(id: string, input: UpdateAgentInput): Promise<UpdateAgentResponse> {
    const current = agents.find((a) => a.id === id);
    if (current === undefined) {
      throw new ApiError("That agent no longer exists.", 404, "agent_not_found");
    }
    const updated: UpdateAgentResponse = {
      id: current.id,
      name: input.name ?? current.name,
      providerSlug: current.providerSlug,
      model: input.model !== undefined ? input.model : current.model,
      status: current.status,
      maxBudgetCents:
        input.maxBudgetCents !== undefined ? input.maxBudgetCents : current.maxBudgetCents,
      upstreamKeyId:
        input.upstreamKeyId !== undefined ? input.upstreamKeyId : current.upstreamKeyId,
      systemPrompt:
        input.systemPrompt !== undefined ? input.systemPrompt : current.systemPrompt,
      blockedTools:
        input.blockedTools !== undefined ? input.blockedTools : current.blockedTools,
      toolDefinitions:
        input.toolDefinitions !== undefined ? input.toolDefinitions : current.toolDefinitions,
    };
    setAgents((prev) => applyUpdated(prev, updated));
    return updated;
  }

  async function freezeAgent(id: string, mode: "soft" | "hard"): Promise<AgentMutationResponse> {
    const status = mode === "hard" ? "hard_frozen" : "soft_frozen";
    setAgents((prev) => applyStatusChange(prev, id, status));
    return { id, status };
  }

  async function unfreezeAgent(id: string): Promise<AgentMutationResponse> {
    setAgents((prev) => applyStatusChange(prev, id, "active"));
    return { id, status: "active" };
  }

  async function deleteAgent(id: string): Promise<AgentMutationResponse> {
    setAgents((prev) => applyDeleted(prev, [id]));
    setRunningId((prev) => (prev === id ? null : prev));
    return { id, status: "archived" };
  }

  return {
    agents,
    actions: { createAgent, updateAgent, freezeAgent, unfreezeAgent, deleteAgent },
    log,
    running,
    runningId,
    setRunningId,
    toggleTraffic: () => setRunning((prev) => !prev),
  };
}
