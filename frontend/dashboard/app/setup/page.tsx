"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HealthBadge, type HealthState } from "@/components/health-badge";
import { CreateAgentDialog } from "@/components/create-agent-dialog";
import {
  API_URL,
  PROXY_URL,
  createAgent,
  listAgents,
  listUpstreamKeys,
  type AgentListItem,
  type UpstreamKeysResponse,
} from "@/lib/api";

/**
 * First-run (and return-anytime) self-host setup wizard.
 *
 * SCOPED DELIBERATELY: the .env that gets Tollgate's own processes running at
 * all (DATABASE_URL, VAULT_ENCRYPTION_KEY, BETTER_AUTH_SECRET, …) has to be
 * written and the containers booted BEFORE this page can even be reached —
 * that chicken-and-egg is scripts/setup-selfhost.sh's job, unchanged, and no
 * page inside the running app can replace it. What this page covers is
 * everything AFTER first boot: confirming the deployment is healthy, adding a
 * provider key, and creating the first agent.
 *
 * NO Q&A ASSISTANT HERE, deliberately — that lives on the public marketing
 * site's /get-started page instead (backend/api/src/lib/
 * install-wizard-assistant.ts), not inside the authenticated app. This page
 * previously had one (Ollama-backed, POST /v1/setup/ask); both the route and
 * local-llm.ts's explain() were removed with it rather than left dead —
 * nothing calls them anymore.
 *
 * Three steps read data that already exists elsewhere (GET /health,
 * GET /v1/upstream-keys, GET /v1/agents) rather than introducing new state —
 * this page doesn't own any information the rest of the dashboard doesn't
 * already show, it just walks a first-time operator through it in order.
 */

interface HealthProbe {
  label: string;
  url: string;
  state: HealthState;
}

async function probeHealth(label: string, url: string): Promise<HealthProbe> {
  try {
    const res = await fetch(`${url}/health`, { cache: "no-store" });
    if (!res.ok) return { label, url, state: "down" };
    const report = (await res.json()) as { ok?: boolean };
    return { label, url, state: report.ok === true ? "up" : "degraded" };
  } catch {
    return { label, url, state: "down" };
  }
}

function StepNumber({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium"
      style={
        done
          ? { background: "var(--ok)", color: "var(--background)" }
          : { border: "1px solid var(--line)", color: "var(--muted-foreground)" }
      }
    >
      {done ? "✓" : n}
    </span>
  );
}

export default function SetupPage() {
  const [health, setHealth] = useState<HealthProbe[] | null>(null);
  const [upstreamKeys, setUpstreamKeys] = useState<UpstreamKeysResponse | null>(null);
  const [agents, setAgents] = useState<AgentListItem[] | null>(null);

  const refreshAgents = useCallback(async () => {
    try {
      setAgents(await listAgents());
    } catch {
      // Non-fatal for this page — the step just shows "checking…" rather
      // than blocking the other two, which don't depend on it.
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      probeHealth("API", API_URL),
      probeHealth("Proxy", PROXY_URL),
    ]).then(setHealth);
    void listUpstreamKeys()
      .then(setUpstreamKeys)
      .catch(() => undefined);
    void refreshAgents();
  }, [refreshAgents]);

  const healthy = health !== null && health.every((h) => h.state === "up");
  const hasKey =
    upstreamKeys !== null && upstreamKeys.providers.some((p) => p.keys.length > 0);
  const hasAgent = agents !== null && agents.length > 0;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-[2.1rem] font-medium tracking-[-0.02em]">Set up Tollgate</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Three steps to a working deployment. Come back here any time —
          nothing below is one-time-only.
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <StepNumber n={1} done={healthy} />
            <div>
              <CardTitle>Check the deployment is healthy</CardTitle>
              <CardDescription>Redis and Postgres reachable from both planes</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {health === null ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : (
            <div className="flex flex-col gap-2">
              {health.map((h) => (
                <div key={h.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {h.label} · <span className="font-mono text-xs">{h.url}</span>
                  </span>
                  <HealthBadge state={h.state} />
                </div>
              ))}
              {!healthy && (
                <p className="text-xs" style={{ color: "var(--amber)" }}>
                  Not all services are up. See{" "}
                  <a href="/status" className="text-brand hover:underline">
                    System status
                  </a>{" "}
                  for detail.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <StepNumber n={2} done={hasKey} />
            <div>
              <CardTitle>Add a provider key</CardTitle>
              <CardDescription>Optional — skip to use the deployment&apos;s shared key</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {upstreamKeys === null ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : !upstreamKeys.vaultConfigured ? (
            <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
              This deployment has no VAULT_ENCRYPTION_KEY set, so it can&apos;t store
              your own provider keys — every agent uses the deployment&apos;s shared
              key instead. That&apos;s a valid setup, not an error.
            </p>
          ) : hasKey ? (
            <p className="text-sm">
              {upstreamKeys.providers.reduce((n, p) => n + p.keys.length, 0)} key(s)
              saved.{" "}
              <a href="/settings" className="text-brand hover:underline">
                Manage in Settings
              </a>
            </p>
          ) : (
            <p className="text-sm">
              None saved yet — every agent will use the deployment&apos;s shared key
              until you add one.{" "}
              <a href="/settings" className="text-brand hover:underline">
                Add a key in Settings
              </a>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <StepNumber n={3} done={hasAgent} />
            <div>
              <CardTitle>Create your first agent</CardTitle>
              <CardDescription>Issues a token your agent's code can call Tollgate with</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {agents === null ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : hasAgent ? (
            <p className="text-sm">
              {agents.length} agent{agents.length === 1 ? "" : "s"} created.{" "}
              <a href="/agents" className="text-brand hover:underline">
                Go to the Dashboard Panel
              </a>
            </p>
          ) : (
            <div className="flex items-center gap-3">
              <CreateAgentDialog
                createAgent={createAgent}
                listUpstreamKeys={listUpstreamKeys}
                existingNames={agents === null ? [] : (agents as AgentListItem[]).map((a) => a.name)}
                onCreated={() => void refreshAgents()}
              />
              <p className="text-sm text-muted-foreground">No agents yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
