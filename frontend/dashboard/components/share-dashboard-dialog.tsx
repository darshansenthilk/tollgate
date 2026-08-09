"use client";

import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import {
  ApiError,
  type DashboardMember,
  type DashboardMembersResponse,
  type DashboardUser,
} from "@/lib/api";

interface ShareDashboardDialogProps {
  open: boolean;
  dashboardName: string;
  /** Injected like renameDashboard on AgentDashboard — decouples this dialog
   *  from lib/api and from which dashboard is active. */
  listDashboardMembers: () => Promise<DashboardMembersResponse>;
  addDashboardMember: (email: string) => Promise<DashboardMember>;
  onOpenChange: (open: boolean) => void;
}

export function ShareDashboardDialog({
  open,
  dashboardName,
  listDashboardMembers,
  addDashboardMember,
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
  /**
   * ONE counter shared by two independent async flows (the member-list fetch
   * and an add-email submission), so it can't be a per-submission id the way
   * RenameDashboardDialog's is. It only advances on the close/reopen edge
   * below — a fetch and an add that are both in flight at once (normal: the
   * user can start typing an email while the list is still loading) keep the
   * SAME generation and neither invalidates the other; only actually closing
   * the dialog mid-flight bumps it, so a stale result can't paint into a
   * dialog the user has since dismissed or reopened for a different dashboard.
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
                </li>
              ))}
              {host === null && members.length === 0 && (
                <li className="text-sm text-muted-foreground">No one has access yet.</li>
              )}
            </ul>
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
