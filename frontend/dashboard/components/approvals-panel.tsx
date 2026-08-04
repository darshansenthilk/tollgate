"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldQuestion } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  ApiError,
  approveRequest,
  denyRequest,
  listApprovals,
  type ApprovalRequest,
} from "@/lib/api";

/**
 * The operator's queue of blocked tool calls awaiting a decision.
 *
 * This is the half of the tool firewall that makes it an escalation path
 * rather than a wall: without it, an agent that hits a blocked tool just fails
 * and the work stops with nobody told. Approving lets that agent's next
 * attempt through once — it does NOT remove the tool from the agent's
 * blocklist, so the standing policy survives the exception.
 *
 * Polls on the same 3s cadence as the agents table and activity log so the
 * three panels never visibly disagree.
 */

const POLL_MS = 3000;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ApprovalsPanel() {
  const [requests, setRequests] = useState<ApprovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ids currently being resolved — disables both buttons on that row so a
  // double-click can't fire approve twice (each grant is single-use, so a
  // second one would arm an extra call the operator never intended).
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      setRequests(await listApprovals());
      setError(null);
    } catch (err) {
      // A 401 already redirects inside lib/api.ts's request(); anything else
      // shows inline rather than blanking the panel.
      setError(err instanceof ApiError ? err.message : "Couldn't load approvals.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function resolve(id: string, action: "approve" | "deny") {
    setPendingIds((prev) => new Set(prev).add(id));
    setError(null);
    try {
      await (action === "approve" ? approveRequest(id) : denyRequest(id));
      // Drop it locally rather than waiting up to 3s for the next poll to
      // stop showing a request the operator just handled.
      setRequests((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
      // Re-read on failure: a 404 here means someone else resolved it, and the
      // queue should reflect that rather than keeping a stale row.
      void refresh();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <Card className="relative">
      <CardHeader>
        <div className="flex items-center gap-3">
          {/* Neutral chip, matching ActivityLog's and AgentDashboard's headers. */}
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--panel)" }}
          >
            <ShieldQuestion className="size-4" style={{ color: "var(--muted-foreground)" }} />
          </span>
          <div>
            <CardTitle>Pending approvals</CardTitle>
            <CardDescription>
              Blocked tool calls waiting on a human decision
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

        {requests === null ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Loading…
          </p>
        ) : requests.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Nothing waiting. When an agent tries a tool its policy blocks, the
            request shows up here for you to approve or deny.
          </p>
        ) : (
          <div className="max-h-[20rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Tool</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((r) => {
                  const busy = pendingIds.has(r.id);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {formatWhen(r.createdAt)}
                      </TableCell>
                      <TableCell>{r.agentName}</TableCell>
                      <TableCell className="font-mono text-xs">{r.toolName}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => void resolve(r.id, "deny")}
                          >
                            Deny
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => void resolve(r.id, "approve")}
                          >
                            Approve once
                          </Button>
                        </div>
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
