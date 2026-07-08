import type { DependencyHealth, HealthReport } from "@tollgate/shared";

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
        <span style={{ color: "var(--muted-foreground)" }}>{name}</span>
      </span>
      <span className="font-mono text-xs" style={{ color: "var(--muted-foreground)" }}>
        {dep.state === "ok" ? `${dep.latencyMs}ms` : dep.detail ?? "error"}
      </span>
    </div>
  );
}

export default async function StatusPage() {
  const probes = await Promise.all(SERVICES.map((s) => probe(s.url)));
  const allOk = probes.every((p) => p.reachable && p.report.ok);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p
          className="mb-2 font-mono text-xs uppercase tracking-[0.25em]"
          style={{ color: "var(--muted-foreground)" }}
        >
          Tollgate
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          System status
        </h1>
        <p className="mt-2 flex items-center gap-2 text-sm" style={{ color: "var(--muted-foreground)" }}>
          <Dot ok={allOk} />
          {allOk
            ? "All services reporting. Redis and Postgres reachable from both planes."
            : "Degraded — one or more checks failing. Is docker compose up?"}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {SERVICES.map((svc, i) => {
          const p = probes[i]!;
          const up = p.reachable && p.report.ok;
          return (
            <section
              key={svc.key}
              className="rounded-lg border p-5"
              style={{ background: "var(--panel)", borderColor: "var(--line)" }}
            >
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-medium">{svc.label}</h2>
                <span
                  className="font-mono text-xs"
                  style={{ color: up ? "var(--ok)" : "var(--err)" }}
                >
                  {p.reachable ? (p.report.ok ? "UP" : "DEGRADED") : "DOWN"}
                </span>
              </div>
              <p className="mb-4 text-xs" style={{ color: "var(--muted-foreground)" }}>
                {svc.role} · <span className="font-mono">{svc.url}</span>
              </p>

              {p.reachable ? (
                <div className="divide-y" style={{ borderColor: "var(--line)" }}>
                  <DepRow name="Redis" dep={p.report.redis} />
                  <DepRow name="Postgres" dep={p.report.postgres} />
                  <div className="flex items-center justify-between py-2 text-sm">
                    <span style={{ color: "var(--muted-foreground)" }}>Uptime</span>
                    <span className="font-mono text-xs" style={{ color: "var(--muted-foreground)" }}>
                      {p.report.uptimeSec}s
                    </span>
                  </div>
                </div>
              ) : (
                <p className="font-mono text-xs" style={{ color: "var(--err)" }}>
                  {p.error}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <footer className="mt-10 text-xs" style={{ color: "var(--muted-foreground)" }}>
        Refresh to re-probe.
      </footer>
    </main>
  );
}
