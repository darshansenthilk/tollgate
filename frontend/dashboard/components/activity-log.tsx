"use client";

import { useCallback, useEffect, useState } from "react";
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
import { ApiError, listActivity, type ActivityEvent } from "@/lib/api";

/**
 * Chronological log of every request an org's agents made — allowed and denied
 * alike. Denials matter most here: a frozen agent still hammering its token, or
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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEvents(await listActivity(100));
      setError(null);
    } catch (err) {
      // A 401 already redirects inside lib/api.ts's request(); anything else
      // shows inline rather than blanking the panel.
      setError(err instanceof ApiError ? err.message : "Couldn't load activity.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <Card className="relative mt-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-brand to-transparent"
      />
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border text-brand"
            style={{
              borderColor: "color-mix(in oklch, var(--brand) 35%, transparent)",
              backgroundColor: "color-mix(in oklch, var(--brand) 12%, transparent)",
            }}
          >
            <ScrollText className="size-4" />
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

        {events === null ? (
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
                        <span className="font-mono text-xs tabular-nums">
                          {formatCost(event.costCents)}
                        </span>
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
