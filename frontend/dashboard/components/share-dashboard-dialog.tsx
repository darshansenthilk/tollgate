"use client";

import { useRef, useState } from "react";
import { DASHBOARD_MEMBER_ROLE_RANK, type DashboardMemberRole } from "@tollgate/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import {
  ApiError,
  type DashboardMember,
  type DashboardMembersResponse,
  type DashboardUser,
  type UpdateDashboardMemberRoleResponse,
} from "@/lib/api";

/** Display copy for each role — keyed by the wire value so a lookup can't
 *  drift out of sync with @tollgate/shared's union. */
const ROLE_LABELS: Record<DashboardMemberRole, string> = {
  observer: "Observer",
  helper: "Helper",
  manager: "Manager",
  moderator: "Moderator",
  admin: "Admin",
};

/** Dropdown lists highest rank first (top of the open menu), lowest last —
 *  PLAN.md's "Admin, Moderator, Manager, Helper, Observer" top-to-bottom.
 *  Derived from DASHBOARD_MEMBER_ROLE_RANK rather than hand-typed, so a role
 *  added to the shared union can't silently go missing from this list the way
 *  a parallel hand-maintained array could — Object.keys is exhaustive over
 *  the rank map's own keys by construction. */
const ROLE_OPTIONS = (Object.keys(DASHBOARD_MEMBER_ROLE_RANK) as DashboardMemberRole[]).sort(
  (a, b) => DASHBOARD_MEMBER_ROLE_RANK[b] - DASHBOARD_MEMBER_ROLE_RANK[a],
);

interface ShareDashboardDialogProps {
  open: boolean;
  dashboardName: string;
  /** Injected like renameDashboard on AgentDashboard — decouples this dialog
   *  from lib/api and from which dashboard is active. */
  listDashboardMembers: () => Promise<DashboardMembersResponse>;
  addDashboardMember: (email: string) => Promise<DashboardMember>;
  /**
   * Host-only role reassignment. Undefined for the marketing demo (which never
   * supplies sharing at all — see AgentDashboard's own gating) — every member
   * row then falls back to the plain non-interactive label the same way it
   * would for a non-host viewer, rather than rendering a dropdown that would
   * 403 on every selection.
   */
  updateDashboardMemberRole?: (
    userId: string,
    role: DashboardMemberRole,
  ) => Promise<UpdateDashboardMemberRoleResponse>;
  onOpenChange: (open: boolean) => void;
}

export function ShareDashboardDialog({
  open,
  dashboardName,
  listDashboardMembers,
  addDashboardMember,
  updateDashboardMemberRole,
  onOpenChange,
}: ShareDashboardDialogProps) {
  // Whichever row's email matches the viewer's own gets the "(You)" tag below
  // — the viewer can be the host OR an added member opening this same dialog,
  // since sharing gives every member full parity (PLAN.md's "Out of scope").
  const { data: sessionData } = authClient.useSession();
  const viewerEmail = sessionData?.user?.email ?? null;

  const [seeded, setSeeded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [host, setHost] = useState<DashboardUser | null>(null);
  const [members, setMembers] = useState<DashboardMember[]>([]);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Which member row has a role change in flight, so its dropdown can disable
  // itself rather than let a second click race the first while it's pending.
  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Host-only: only the account that created this dashboard sees a clickable
  // role, everyone else (including a member viewing their own row) gets the
  // same plain label the Host span already uses — PLAN.md's D3/"host-only".
  const isHost = viewerEmail !== null && host !== null && host.email === viewerEmail;
  /**
   * ONE counter shared by three independent async flows (the member-list
   * fetch, an add-email submission, and a role-change PATCH), so it can't be
   * a per-submission id the way RenameDashboardDialog's is. It only advances
   * on the close/reopen edge below — any number of these in flight at once
   * (normal: the user can start typing an email, or click a role, while the
   * list is still loading) keep the SAME generation and none invalidates the
   * others; only actually closing the dialog mid-flight bumps it, so a stale
   * result can't paint into a dialog the user has since dismissed or reopened
   * for a different dashboard.
   */
  const generation = useRef(0);

  if (open && !seeded) {
    setSeeded(true);
    setEmail("");
    setAddError(null);
    setLoadError(null);
    setAdding(false);
    setHost(null);
    setMembers([]);
    setPendingRoleUserId(null);
    setRoleError(null);

    const gen = generation.current;
    setLoading(true);
    void listDashboardMembers()
      .then((res) => {
        if (generation.current !== gen) return;
        setHost(res.host);
        setMembers(res.members);
      })
      .catch((err: unknown) => {
        if (generation.current !== gen) return;
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load who has access.");
      })
      .finally(() => {
        if (generation.current === gen) setLoading(false);
      });
  } else if (!open && seeded) {
    setSeeded(false);
    generation.current += 1;
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed === "") return;

    const gen = generation.current;
    setAdding(true);
    setAddError(null);
    try {
      const member = await addDashboardMember(trimmed);
      if (generation.current !== gen) return;
      // Append in place rather than refetching the whole list — matches
      // "the drop down will still show but now that email has been added".
      // Re-adding an existing member (the api is idempotent) replaces their
      // row instead of duplicating it.
      setMembers((prev) => [...prev.filter((m) => m.id !== member.id), member]);
      setEmail("");
    } catch (err) {
      if (generation.current !== gen) return;
      setAddError(err instanceof ApiError ? err.message : "Couldn't add that email.");
    } finally {
      if (generation.current === gen) setAdding(false);
    }
  }

  async function handleRoleChange(userId: string, role: DashboardMemberRole) {
    if (updateDashboardMemberRole === undefined) return;

    const gen = generation.current;
    setPendingRoleUserId(userId);
    setRoleError(null);
    try {
      const result = await updateDashboardMemberRole(userId, role);
      if (generation.current !== gen) return;
      setMembers((prev) =>
        prev.map((m) => (m.id === result.userId ? { ...m, role: result.role } : m)),
      );
    } catch (err) {
      if (generation.current !== gen) return;
      setRoleError(err instanceof ApiError ? err.message : "Couldn't change that role.");
    } finally {
      if (generation.current === gen) setPendingRoleUserId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share &quot;{dashboardName}&quot;</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : loadError !== null ? (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {loadError}
            </p>
          ) : (
            <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
              {host !== null && (
                <li className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-baseline gap-1">
                    <span className="min-w-0 truncate">{host.email}</span>
                    {viewerEmail !== null && host.email === viewerEmail && (
                      <span className="shrink-0 text-xs text-muted-foreground">(You)</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">Host</span>
                </li>
              )}
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-baseline gap-1">
                    <span className="min-w-0 truncate">{m.email}</span>
                    {viewerEmail !== null && m.email === viewerEmail && (
                      <span className="shrink-0 text-xs text-muted-foreground">(You)</span>
                    )}
                  </span>
                  {isHost && updateDashboardMemberRole !== undefined ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        disabled={pendingRoleUserId === m.id}
                        className="shrink-0 text-xs text-muted-foreground outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                      >
                        {pendingRoleUserId === m.id ? "Updating…" : ROLE_LABELS[m.role]}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {ROLE_OPTIONS.map((role) => (
                          <DropdownMenuItem
                            key={role}
                            onClick={() => void handleRoleChange(m.id, role)}
                          >
                            {ROLE_LABELS[role]}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {ROLE_LABELS[m.role]}
                    </span>
                  )}
                </li>
              ))}
              {host === null && members.length === 0 && (
                <li className="text-sm text-muted-foreground">No one has access yet.</li>
              )}
            </ul>
          )}
          {roleError !== null && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {roleError}
            </p>
          )}
        </div>

        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          <Label htmlFor="share-dashboard-email">Add someone by email</Label>
          <div className="flex gap-2">
            <Input
              id="share-dashboard-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={adding || email.trim() === ""}>
              {adding ? "Adding…" : "Add"}
            </Button>
          </div>
          {addError !== null && (
            <p className="text-sm" style={{ color: "var(--err)" }}>
              {addError}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
