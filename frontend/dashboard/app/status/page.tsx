import type { DependencyHealth, HealthReport } from "@tollgate/shared";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HealthBadge, type HealthState } from "@/components/health-badge";

const SERVICES = [
  {
    key: "proxy" as const,
    label: "Proxy",
    role: "Data plane · agent traffic gate",
    url: process.env.NEXT_PUBLIC_PROXY_URL ?? "http://localhost:8080",
  },
  {
    key: "api" as const,
    label: "API",
    role: "Control plane · management endpoints",
    url: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  },
];

type Probe =
  | { reachable: true; report: HealthReport }
  | { reachable: false; error: string };

async function probe(url: string): Promise<Probe> {
  try {
    const res = await fetch(`${url}/health`, { cache: "no-store" });
    const report = (await res.json()) as HealthReport;
    return { reachable: true, report };
  } catch (err) {
    return {
      reachable: false,
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

/** Map a probe to the three functional health states the HealthBadge renders. */
function healthState(p: Probe): HealthState {
  if (!p.reachable) return "down";
  return p.report.ok ? "up" : "degraded";
}

/** uptimeSec → "1h 04m" / "5m 03s" / "42s". Reads more finished than raw seconds. */
function formatUptime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: ok ? "var(--ok)" : "var(--err)" }}
    />
  );
}

function DepRow({ name, dep }: { name: string; dep: DependencyHealth }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="flex items-center gap-2">
        <Dot ok={dep.state === "ok"} />
        <span className="text-muted-foreground">{name}</span>
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {dep.state === "ok" ? `${dep.latencyMs}ms` : dep.detail ?? "error"}
      </span>
    </div>
  );
}

export default async function StatusPage() {
  const probes = await Promise.all(SERVICES.map((s) => probe(s.url)));
  const allOk = probes.every((p) => p.reachable && p.report.ok);

  // Newest timestamp across the reachable probes, for the "last checked" line.
  // flatMap narrows the union so `p.report` is accessible; ISO strings sort
  // chronologically as plain strings.
  const lastChecked = probes
    .flatMap((p) => (p.reachable ? [p.report.timestamp] : []))
    .sort()
    .at(-1);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-6">
        {/* Plain heading, matching the fix on AgentDashboard's own title
            (see agent-dashboard.tsx) — the bracket marks + gradient clip
            were the same eyebrow idiom retired everywhere else. */}
        <h1 className="text-[2.1rem] font-medium tracking-[-0.02em]">System status</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Dot ok={allOk} />
          {allOk
            ? "All services reporting. Redis and Postgres reachable from both planes."
            : "Degraded — one or more checks failing. Is docker compose up?"}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {SERVICES.map((svc, i) => {
          const p = probes[i]!;
          return (
            <Card key={svc.key}>
              <CardHeader>
                <CardTitle>{svc.label}</CardTitle>
                <CardDescription>
                  {svc.role} · <span className="font-mono">{svc.url}</span>
                </CardDescription>
                <CardAction>
                  <HealthBadge state={healthState(p)} />
                </CardAction>
              </CardHeader>
              <CardContent>
                {p.reachable ? (
                  <div className="divide-y divide-border">
                    <DepRow name="Redis" dep={p.report.redis} />
                    <DepRow name="Postgres" dep={p.report.postgres} />
                    <div className="flex items-center justify-between py-2 text-sm">
                      <span className="text-muted-foreground">Uptime</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatUptime(p.report.uptimeSec)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="font-mono text-xs" style={{ color: "var(--err)" }}>
                    {p.error}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <footer className="mt-8 text-xs text-muted-foreground">
        {lastChecked
          ? `Last checked ${new Date(lastChecked).toLocaleTimeString()} · refresh to re-probe.`
          : "Refresh to re-probe."}
      </footer>
    </main>
  );
}
