"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateDashboardDialog } from "@/components/create-dashboard-dialog";
import { DashboardTile } from "@/components/dashboard-tile";
import {
  ApiError,
  getActiveDashboard,
  listDashboards,
  selectDashboard,
  type Dashboard,
} from "@/lib/api";

export function ManageDashboards() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      // allSettled, not all: the two calls are independent, and a failed
      // active-dashboard lookup must not discard a list that arrived fine —
      // that would render an org's existing dashboards as an empty grid.
      const [listed, active] = await Promise.allSettled([
        listDashboards(),
        getActiveDashboard(),
      ]);

      const message = (err: unknown) =>
        err instanceof ApiError ? err.message : "Failed to reach the api";

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

  const handleSelect = useCallback(
    async (id: string) => {
      try {
        await selectDashboard(id);
        router.push("/agents");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to reach the api");
      }
    },
    [router],
  );

  // The dialog navigates to /agents itself; this only keeps the grid honest for
  // a back-navigation into a still-mounted page (DE7 append order, DE11 active).
  function handleCreated(dashboard: Dashboard) {
    setDashboards((prev) => (prev === null ? [dashboard] : [...prev, dashboard]));
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
            />
          ))}
        </div>
      )}
    </main>
  );
}
