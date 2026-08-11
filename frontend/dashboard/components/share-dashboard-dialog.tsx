"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
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
  type DashboardRole,
  type DashboardUser,
  type UpdateDashboardMemberRoleResponse,
} from "@/lib/api";

/**
 * No ROLE_LABELS here anymore, and no options list either. Roles are rows the
 * host creates on the permissions popup, so both the labels and the options
 * are fetched (listDashboardRoles) rather than derived from a compile-time
 * union — a member row's own `role.name` is what labels it.
 */

interface ShareDashboardDialogProps {
  open: boolean;
  dashboardName: string;
  /** Injected like renameDashboard on AgentDashboard — decouples this dialog
   *  from lib/api and from which dashboard is active. */
  listDashboardMembers: () => Promise<DashboardMembersResponse>;
  /** The role dropdown's OPTIONS. Not host-only on the api, deliberately: a
   *  member already sees a role name on every row here, so the names are not
   *  new information. */
  listDashboardRoles: () => Promise<DashboardRole[]>;
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
    roleId: string,
  ) => Promise<UpdateDashboardMemberRoleResponse>;
  /**
   * Host-only member removal. Same optional gating as updateDashboardMemberRole
   * above — undefined for the marketing demo, which then renders no "x" at all
   * rather than one that would 403 on every click.
   */
  removeDashboardMember?: (userId: string) => Promise<void>;
  /**
   * The viewer's own standing on inviting new members (AgentDashboard's
   * myPermissions) — default true so the host (and every caller that hasn't
   * wired myPermissions through) keeps today's behaviour. A restricted
   * Observer sees the member list but not the add-by-email form; the api
   * enforces this regardless, this only avoids a 403 after a submit that was
   * never going to work.
   */
  canAddMember?: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDashboardDialog({
  open,
  dashboardName,
  listDashboardMembers,
  listDashboardRoles,
  addDashboardMember,
  updateDashboardMemberRole,
  removeDashboardMember,
  canAddMember = true,
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
  /** The dropdown's options. Empty is a legitimate state — see the fetch's
   *  catch branch — and renders every row as a plain label instead. */
  const [roles, setRoles] = useState<DashboardRole[]>([]);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Which member row has a role change in flight, so its dropdown can disable
  // itself rather than let a second click race the first while it's pending.
  const [pendingRoleUserId, setPendingRoleUserId] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  // Which member is queued up in the remove-confirmation dialog, and which
  // one (if any) has a DELETE actually in flight — kept separate from
  // pendingRoleUserId so a role change and a removal can't race the same row.
  const [confirmingRemoveUserId, setConfirmingRemoveUserId] = useState<string | null>(null);
  const [pendingRemoveUserId, setPendingRemoveUserId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
    setRoles([]);
    setPendingRoleUserId(null);
    setRoleError(null);
    setConfirmingRemoveUserId(null);
    setPendingRemoveUserId(null);
    setRemoveError(null);

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

    // In parallel with the member list, under the same generation guard —
    // neither depends on the other, and the rows can render their own
    // `role.name` before these options arrive.
    void listDashboardRoles()
      .then((res) => {
        if (generation.current !== gen) return;
        setRoles(res);
      })
      .catch(() => {
        // Deliberately not surfaced as an error and deliberately not tied to
        // `loading`: the point of this dialog is the member list, and every
        // row can still label its own role without these. With no options the
        // rows fall back to plain non-interactive labels rather than showing a
        // dropdown that opens onto nothing.
        if (generation.current !== gen) return;
        setRoles([]);
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
      // The api rejects a repeat add (dashboard_member_already_exists) rather
      // than no-opping, so a successful response here is always a genuinely
      // new member — the filter is just defensive against a duplicate key.
      setMembers((prev) => [...prev.filter((m) => m.id !== member.id), member]);
      setEmail("");
    } catch (err) {
      if (generation.current !== gen) return;
      setAddError(err instanceof ApiError ? err.message : "Couldn't add that email.");
    } finally {
      if (generation.current === gen) setAdding(false);
    }
  }

  async function handleRoleChange(userId: string, roleId: string) {
    if (updateDashboardMemberRole === undefined) return;
    // Re-picking the role a member already has is a no-op, not a PATCH. This
    // was harmless when the menu had exactly one option; now that a host can
    // create several, it's a request that would change nothing.
    if (members.find((m) => m.id === userId)?.role.id === roleId) return;

    const gen = generation.current;
    setPendingRoleUserId(userId);
    setRoleError(null);
    try {
      const result = await updateDashboardMemberRole(userId, roleId);
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

  async function handleRemove() {
    if (removeDashboardMember === undefined || confirmingRemoveUserId === null) return;
    const userId = confirmingRemoveUserId;

    const gen = generation.current;
    setPendingRemoveUserId(userId);
    setRemoveError(null);
    try {
      await removeDashboardMember(userId);
      if (generation.current !== gen) return;
      // Drop the row from local state rather than refetching — same
      // update-in-place style as handleAdd/handleRoleChange above.
      setMembers((prev) => prev.filter((m) => m.id !== userId));
      setConfirmingRemoveUserId(null);
    } catch (err) {
      if (generation.current !== gen) return;
      setRemoveError(err instanceof ApiError ? err.message : "Couldn't remove that member.");
    } finally {
      if (generation.current === gen) setPendingRemoveUserId(null);
    }
  }

  return (
    // One Dialog, no nesting — the remove confirmation is an inline panel in
    // the member row it targets. Consequence worth stating: Escape now closes
    // the WHOLE share dialog, including while a removal is in flight, where the
    // nested confirm dialog used to be topmost and swallow it. Accepted rather
    // than guarded, matching SharePermissionsDialog: closing mid-request is
    // already allowed for an in-flight role change, `generation` discards the
    // response, the request still lands server-side, and the next open refetches
    // the member list from scratch.
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
                <li key={m.id} className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="min-w-0 truncate">{m.email}</span>
                      {viewerEmail !== null && m.email === viewerEmail && (
                        <span className="shrink-0 text-xs text-muted-foreground">(You)</span>
                      )}
                      {isHost && removeDashboardMember !== undefined && (
                        <button
                          type="button"
                          onClick={() => {
                            // Clear any error left over from a previous target
                            // row — otherwise it briefly shows on THIS row's
                            // confirmation panel before any request for it has
                            // run.
                            setRemoveError(null);
                            setConfirmingRemoveUserId(m.id);
                          }}
                          disabled={pendingRoleUserId === m.id || pendingRemoveUserId === m.id}
                          aria-label={`Remove ${m.email} from this dashboard`}
                          aria-expanded={confirmingRemoveUserId === m.id}
                          className="shrink-0 text-muted-foreground outline-none transition-colors hover:text-[var(--err)] disabled:pointer-events-none disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {/* roles.length > 0 as well as the host check: if the
                          options fetch failed there's nothing to pick from, so
                          the row falls back to the same plain label a non-host
                          viewer gets rather than an empty menu. */}
                      {isHost && updateDashboardMemberRole !== undefined && roles.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={pendingRoleUserId === m.id || pendingRemoveUserId === m.id}
                            className="shrink-0 text-xs text-muted-foreground outline-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                          >
                            {pendingRoleUserId === m.id ? "Updating…" : m.role.name}
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {roles.map((role) => (
                              <DropdownMenuItem
                                key={role.id}
                                onClick={() => void handleRoleChange(m.id, role.id)}
                              >
                                {role.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {m.role.name}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Confirmation lives INSIDE the row it targets, not at the
                      bottom of the dialog: this list can be long enough to
                      scroll, and a panel anywhere else would ask the host to
                      remember which of several similar emails they clicked.
                      Scoping the condition to `m.id` here is also what makes an
                      orphaned confirmation impossible — if the member leaves
                      the list, the panel it belongs to is simply not
                      rendered. */}
                  {confirmingRemoveUserId === m.id && (
                    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                      <p>Remove this member from the dashboard?</p>

                      {removeError !== null && (
                        <p style={{ color: "var(--err)" }}>{removeError}</p>
                      )}

                      <div className="flex justify-end gap-2">
                        {/* Focus lands on Cancel, not Remove — the panel opens
                            without a focus trap, so something must take focus
                            for a keyboard user to notice it, and it should
                            never be the destructive choice. */}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          autoFocus
                          onClick={() => {
                            setConfirmingRemoveUserId(null);
                            setRemoveError(null);
                          }}
                          disabled={pendingRemoveUserId !== null}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleRemove()}
                          disabled={pendingRemoveUserId !== null}
                        >
                          {pendingRemoveUserId !== null ? "Removing…" : "Remove"}
                        </Button>
                      </div>
                    </div>
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

        {canAddMember && (
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
        )}
      </DialogContent>
    </Dialog>
  );
}
