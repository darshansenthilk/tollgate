"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { providerLabel } from "@/lib/agent-options";
import {
  ApiError,
  getActiveDashboard,
  listActivity,
  type ActivityEvent,
  type Dashboard,
} from "@/lib/api";

/**
 * Chronological log of every request the open dashboard's agents made — allowed
 * and denied alike. Scoped to one dashboard, like the agent table it mirrors. Denials matter most here: a frozen agent still hammering its token, or
 * one grinding against an exhausted budget, is exactly what an operator wants
 * to see, and until the proxy started recording them this panel would have
 * shown only the traffic that succeeded.
 *
 * Polls on the same 3s cadence as the agents table above it so the two don't
 * visibly disagree about what just happened.
 */

const POLL_MS = 3000;

/** Cost arrives as fractional cents (e.g. 0.045). Sub-cent amounts are real and
 *  common for small requests, so they get extra precision rather than rounding
 *  to "$0.00" and looking broken. */
function formatCost(cents: number | null): string {
  if (cents === null) return "—";
  if (cents === 0) return "$0.00";
  const dollars = cents / 100;
  return dollars < 0.01 ? `$${dollars.toFixed(5)}` : `$${dollars.toFixed(2)}`;
}

function formatWhen(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
}

/** Same tinted-outline recipe as AgentStatusBadge — one token drives text,
 *  border and wash, so these read as the same family of pill. */
function ToneBadge({ label, color }: { label: string; color: string }) {
  return (
    <Badge
      variant="outline"
      style={{
        color,
        borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </Badge>
  );
}

/**
 * A request that really consumed tokens but metered at zero — i.e. Tollgate
 * has no price for the model the provider reported serving.
 *
 * Worth calling out rather than rendering as "$0.0000": the spend is real and
 * is being billed by the provider, it just isn't counted against the agent's
 * budget, so budget enforcement is quietly not protecting that agent. Scoped
 * to allowed requests because a denial legitimately costs nothing.
 */
function isUnpriced(event: ActivityEvent): boolean {
  return (
    event.decision === "allowed" &&
    event.totalTokens !== null &&
    event.totalTokens > 0 &&
    (event.costCents === null || event.costCents === 0)
  );
}

function DecisionBadge({ event }: { event: ActivityEvent }) {
  if (event.decision === "allowed") {
    // An allowed request can still have failed upstream (a 401 from the
    // provider, say) — that's Tollgate letting it through, not the call
    // succeeding, and conflating the two would be misleading.
    const failedUpstream = event.upstreamStatus !== null && event.upstreamStatus >= 400;
    return failedUpstream ? (
      <ToneBadge label={`Upstream ${event.upstreamStatus}`} color="var(--amber)" />
    ) : (
      <ToneBadge label="Allowed" color="var(--ok)" />
    );
  }

  const label =
    event.decision === "denied_budget"
      ? "Over budget"
      : event.decision === "denied_frozen"
        ? "Frozen"
        : event.decision === "denied_rate"
          ? "Rate limited"
          : "Blocked";

  return <ToneBadge label={label} color="var(--err)" />;
}

export function ActivityLog() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  // undefined until the first lookup lands, so the panel doesn't flash the
  // "create a dashboard" state at someone who already has one. Same three-state
  // convention as app/agents/page.tsx.
  const [activeDashboard, setActiveDashboard] = useState<Dashboard | null | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (dashboardId: string) => {
    try {
      setEvents(await listActivity(dashboardId, 100));
      setError(null);
    } catch (err) {
      // A 401 already redirects inside lib/api.ts's request(); anything else
      // shows inline rather than blanking the panel.
      setError(err instanceof ApiError ? err.message : "Couldn't load activity.");
    }
  }, []);

  // The feed is per-dashboard now, so this panel has to know which one is open.
  // It resolves that itself rather than taking it as a prop: /activity is a
  // server component rendering this single client child (the App Router shape
  // this codebase requires), so there's no client-side parent to fetch it.
  useEffect(() => {
    let cancelled = false;
    let retryId: ReturnType<typeof setTimeout> | undefined;

    async function lookUpActiveDashboard(): Promise<void> {
      try {
        const active = await getActiveDashboard();
        if (cancelled) return;
        setActiveDashboard(active);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        // Don't fall back to "no dashboard" — a failed lookup isn't proof of
        // one. Retry on the poll interval so a transient api blip self-heals
        // instead of pinning the panel on "Loading…" forever (the same trap
        // app/agents/page.tsx documents).
        setError(err instanceof ApiError ? err.message : "Couldn't load activity.");
        retryId = setTimeout(() => void lookUpActiveDashboard(), POLL_MS);
      }
    }

    void lookUpActiveDashboard();
    return () => {
      cancelled = true;
      if (retryId !== undefined) clearTimeout(retryId);
    };
  }, []);

  const activeDashboardId = activeDashboard?.id ?? null;

  useEffect(() => {
    if (activeDashboardId === null) return;
    // Clear first, so switching dashboards can't show the previous one's
    // requests under the new one — see the same guard in app/agents/page.tsx.
    setEvents(null);
    void refresh(activeDashboardId);
    const id = window.setInterval(() => void refresh(activeDashboardId), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh, activeDashboardId]);

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-center gap-3">
          {/* Neutral chip, not brand-tinted — matches the same fix on
              AgentDashboard's header icon (see agent-dashboard.tsx). */}
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--panel)" }}
          >
            <ScrollText className="size-4" style={{ color: "var(--muted-foreground)" }} />
          </span>
          <div>
            <CardTitle>Activity log</CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              Every request, allowed and blocked
              <span
                aria-hidden
                className="size-1.5 rounded-full animate-pulse motion-reduce:animate-none"
                style={{ backgroundColor: "var(--ok)" }}
              />
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error !== null && (
          <p className="mb-3 text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}

        {activeDashboard === null ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No dashboard yet. Create one in{" "}
            <Link href="/dashboards" className="text-brand hover:underline">
              Manage Dashboards
            </Link>{" "}
            to start recording activity.
          </p>
        ) : activeDashboard === undefined || events === null ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Loading…
          </p>
        ) : events.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            No requests yet — once an agent calls through the proxy, every request
            shows up here.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Assistant</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const when = formatWhen(event.createdAt);
                  return (
                    <TableRow key={event.id}>
                      <TableCell>
                        <div className="flex flex-col leading-tight">
                          <span className="font-mono text-xs">{when.time}</span>
                          <span
                            className="font-mono text-[0.7rem]"
                            style={{ color: "var(--muted-foreground)" }}
                          >
                            {when.date}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{event.agentName}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {providerLabel(event.assistant)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="font-mono text-xs"
                          style={
                            event.model === null
                              ? { color: "var(--muted-foreground)" }
                              : undefined
                          }
                        >
                          {event.model ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DecisionBadge event={event} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-xs tabular-nums">
                          {event.totalTokens === null
                            ? "—"
                            : event.totalTokens.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {isUnpriced(event) ? (
                          // Real tokens but no cost means Tollgate has no price
                          // for this model, so this request spent money that
                          // never counted against the agent's budget. That has
                          // to be visible — a plain "$0.0000" reads as "this
                          // was free", which is the opposite of the truth.
                          <span
                            className="font-mono text-xs tabular-nums"
                            style={{ color: "var(--amber)" }}
                            title={`Tollgate has no price for ${event.model ?? "this model"}, so its spend isn't counted against the budget.`}
                          >
                            unpriced
                          </span>
                        ) : (
                          <span className="font-mono text-xs tabular-nums">
                            {formatCost(event.costCents)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
