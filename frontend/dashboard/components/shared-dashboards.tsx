"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardsNav } from "@/components/dashboards-nav";
import { DashboardTile } from "@/components/dashboard-tile";
import {
  ApiError,
  getActiveDashboard,
  listSharedDashboards,
  selectDashboard,
  type DashboardListItem,
} from "@/lib/api";

/**
 * The real data-source version of this page — slice 5 (claude-docs/PLANS.md,
 * D7) shipped this as a static empty-state stub because `dashboards` had no
 * per-user "shared with me" concept to query. dashboard_members (PLAN.md)
 * is that concept: this fetches GET /v1/dashboards/shared instead of
 * hardcoding the empty branch.
 *
 * No create tile (DashboardTile is rendered with no onDelete either — a
 * shared user gets neither affordance here, both are the host's business)
 * and, unlike manage-dashboards.tsx, no polling: the grid loads once, same
 * as My Dashboards.
 */
export function SharedDashboards() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<DashboardListItem[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = (err: unknown) =>
    err instanceof ApiError ? err.message : "Failed to reach the api";

  useEffect(() => {
    void (async () => {
      // allSettled, not all — same reasoning as manage-dashboards.tsx: a
      // failed active-dashboard lookup shouldn't discard a shared list that
      // arrived fine.
      const [listed, active] = await Promise.allSettled([
        listSharedDashboards(),
        getActiveDashboard(),
      ]);

      if (listed.status === "fulfilled") {
        setDashboards(listed.value);
      } else {
        setError(message(listed.reason));
        setDashboards([]);
      }

      if (active.status === "fulfilled") {
        setActiveId(active.value === null ? null : active.value.id);
      } else if (listed.status === "fulfilled") {
        setError(message(active.reason));
      }
    })();
  }, []);

  async function handleSelect(id: string) {
    try {
      await selectDashboard(id);
      router.push("/agents");
    } catch (err) {
      setError(message(err));
      // The host revoked access, or deleted the dashboard, since this list
      // loaded — drop the now-stale tile rather than leaving it clickable.
      if (err instanceof ApiError && err.code === "dashboard_not_found") {
        setDashboards((prev) => (prev === null ? prev : prev.filter((d) => d.id !== id)));
      }
    }
  }

  return (
    <div>
      <header className="mb-6 pl-4 text-left">
        <h1 className="text-[2.1rem] font-medium tracking-[-0.02em]">
          Shared Dashboards
        </h1>
        <p className="text-sm text-muted-foreground">
          Dashboards other members have shared with you.
        </p>
      </header>

      {/* Below the subtitle, not above the header — mb-6 pl-4 mirrors the
          header's own spacing/indent, same placement as manage-dashboards.tsx. */}
      <div className="mb-6 pl-4">
        <DashboardsNav />
      </div>

      {error !== null && (
        <p className="mb-4 pl-4 text-sm" style={{ color: "var(--err)" }}>
          {error}
        </p>
      )}

      {dashboards === null ? (
        <p className="pl-4 text-sm" style={{ color: "var(--muted-foreground)" }}>
          Loading…
        </p>
      ) : dashboards.length === 0 ? (
        // pl-4 matches the header's own pl-4 above so this lines up under the
        // subtitle, rather than the grid's unindented left edge.
        <p className="pl-4 text-sm" style={{ color: "var(--muted-foreground)" }}>
          No dashboards have been shared with you yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
    </div>
  );
}
