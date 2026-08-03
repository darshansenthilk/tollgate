"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateDashboardDialog } from "@/components/create-dashboard-dialog";
import { DashboardTile } from "@/components/dashboard-tile";
import { DeleteDashboardDialog } from "@/components/delete-dashboard-dialog";
import {
  ApiError,
  deleteDashboard,
  getActiveDashboard,
  listDashboards,
  selectDashboard,
  type Dashboard,
  type DashboardListItem,
} from "@/lib/api";

export function ManageDashboards() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<DashboardListItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The dashboard whose confirmation is open. One dialog for the whole grid,
   *  driven by this — not one mounted per tile (see DeleteDashboardDialog). */
  const [deleting, setDeleting] = useState<DashboardListItem | null>(null);
  /** Guards the counts refetch below so a double-click can't start two. */
  const [preparingId, setPreparingId] = useState<string | null>(null);

  const message = (err: unknown) =>
    err instanceof ApiError ? err.message : "Failed to reach the api";

  useEffect(() => {
    void (async () => {
      // allSettled, not all: the two calls are independent, and a failed
      // active-dashboard lookup must not discard a list that arrived fine —
      // that would render an org's existing dashboards as an empty grid.
      const [listed, active] = await Promise.allSettled([
        listDashboards(),
        getActiveDashboard(),
      ]);

      if (listed.status === "fulfilled") {
        setDashboards(listed.value);
      } else {
        setError(message(listed.reason));
        // Drop out of the loading state anyway so the create tile stays
        // reachable — a failed list shouldn't leave "Loading…" on screen for
        // good, since nothing retries here.
        setDashboards([]);
      }

      // Only costs the selected-state ring (DE10) if it fails, so it never
      // overwrites a list error with its own.
      if (active.status === "fulfilled") {
        setActiveId(active.value === null ? null : active.value.id);
      } else if (listed.status === "fulfilled") {
        setError(message(active.reason));
      }
    })();
  }, []);

  /** Drops a tile that the api says is already gone. The grid loads once and
   *  never polls, so without this a ghost tile stays clickable forever. */
  const forget = useCallback((id: string) => {
    setDashboards((prev) => (prev === null ? prev : prev.filter((d) => d.id !== id)));
    setDeleting((prev) => (prev !== null && prev.id === id ? null : prev));
  }, []);

  const handleSelect = useCallback(
    async (id: string) => {
      try {
        await selectDashboard(id);
        router.push("/agents");
      } catch (err) {
        setError(message(err));
        // A stale tile for a dashboard someone else deleted: painting the error
        // alone would leave it on screen and clickable indefinitely.
        if (err instanceof ApiError && err.code === "dashboard_not_found") forget(id);
      }
    },
    [router, forget],
  );

  /** Applies a completed delete: drop the tile, and move the ring using the
   *  selection the api just returned. activeId is otherwise only ever written by
   *  handleCreated, so without this the ring would sit on a tile that's gone. */
  const applyDeleted = useCallback((id: string, nextActive: Dashboard | null) => {
    setDashboards((prev) => (prev === null ? prev : prev.filter((d) => d.id !== id)));
    setActiveId(nextActive === null ? null : nextActive.id);
    setError(null);
  }, []);

  const runDelete = useCallback(
    async (id: string) => {
      try {
        const result = await deleteDashboard(id);
        applyDeleted(id, result.activeDashboard);
      } catch (err) {
        // A 404 from our OWN delete means someone (another tab, a second click)
        // already deleted it — the end state the user asked for. Treat it as
        // success, but re-resolve the selection, since this response carried
        // none and the server may have re-pointed us at a survivor.
        if (err instanceof ApiError && err.code === "dashboard_not_found") {
          const active = await getActiveDashboard().catch(() => null);
          applyDeleted(id, active);
          return;
        }
        throw err;
      }
    },
    [applyDeleted],
  );

  /**
   * The 3-dot menu's Delete. REFETCHES THE COUNTS FIRST: the grid loads once on
   * mount and never polls, so its counts can be minutes stale — and a stale
   * `agentCount === 0` is exactly what would skip the confirmation entirely and
   * delete a dashboard full of running agents with no prompt. One extra request
   * on a deliberate destructive action is a fair price, and it self-heals ghost
   * tiles for the rest of the grid at the same time.
   */
  const handleDeleteRequest = useCallback(
    async (id: string) => {
      if (preparingId !== null) return;
      setPreparingId(id);
      try {
        const fresh = await listDashboards();
        setDashboards(fresh);
        setError(null);

        const target = fresh.find((d) => d.id === id);
        if (target === undefined) {
          // Already gone. The refetch above has removed its tile, so there is
          // nothing left to confirm.
          setActiveId((prev) => (prev === id ? null : prev));
          return;
        }

        // Zero agents means no dialog and no warning at all — the tile just
        // goes. Note this counts NON-ARCHIVED agents: a dashboard whose agents
        // were each deleted individually reports 0 and deletes silently, which
        // is right, because to the user it is empty. It does NOT mean a hard
        // delete would succeed — those archived rows still hold the FK.
        if (target.agentCount === 0) {
          await runDelete(id);
          return;
        }

        setDeleting(target);
      } catch (err) {
        setError(message(err));
      } finally {
        setPreparingId(null);
      }
    },
    [preparingId, runDelete],
  );

  // The dialog navigates to /agents itself; this only keeps the grid honest for
  // a back-navigation into a still-mounted page (DE7 append order, DE11 active).
  // A brand-new dashboard has no agents by construction, so the counts the list
  // route would return for it are known without asking.
  function handleCreated(dashboard: Dashboard) {
    const item: DashboardListItem = { ...dashboard, agentCount: 0, liveAgentCount: 0 };
    setDashboards((prev) => (prev === null ? [item] : [...prev, item]));
    setActiveId(dashboard.id);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-6 pl-4 text-left">
        {/* Matches Agent Dashboard's h1 + pl-4 offset (components/agent-
            dashboard.tsx) — the page behind the "Dashboard Panel" nav tab —
            rather than the font-heading scale other stub-ish pages
            (Settings) use. pl-4 lines the heading's left edge up with the
            Card's inner content below instead of the page's outer edge. */}
        <h1 className="text-[2.1rem] font-medium tracking-[-0.02em]">
          Manage Dashboards
        </h1>
        <p className="text-sm text-muted-foreground">
          Create a dashboard and view shared ones.
        </p>
      </header>

      {error !== null && (
        <p className="mb-4 text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

      {dashboards === null ? (
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CreateDashboardDialog onCreated={handleCreated} />
          {dashboards.map((dashboard) => (
            <DashboardTile
              key={dashboard.id}
              dashboard={dashboard}
              active={dashboard.id === activeId}
              onSelect={(id) => void handleSelect(id)}
              onDelete={(id) => void handleDeleteRequest(id)}
            />
          ))}
        </div>
      )}

      <DeleteDashboardDialog
        dashboard={deleting}
        deleteDashboard={runDelete}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </main>
  );
}
