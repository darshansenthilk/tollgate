import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Placeholder for the Dashboard Expansion feature (PLAN.md) — multiple
 * dashboards per user, shareable with per-user permissions, à la Google
 * Docs. Nav tab + route scaffolded first; no data model or sharing logic
 * yet, so this renders a stub rather than 404ing off the new nav link.
 */
export default function ManageDashboardsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Manage Dashboards
        </h1>
        <p className="text-sm text-muted-foreground">
          Create, share, and manage permissions across multiple dashboards.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            This is a placeholder for the Dashboard Expansion feature — see
            PLAN.md for the full writeup. Implementation hasn&apos;t started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The dashboard you use today at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              /agents
            </code>{" "}
            will become one of potentially many — each shareable with other
            users at varying permission levels.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
