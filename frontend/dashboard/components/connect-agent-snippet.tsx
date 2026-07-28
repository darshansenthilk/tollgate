"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildConnectSnippets } from "@/lib/agent-connect";
import { cn } from "@/lib/utils";

interface ConnectAgentSnippetProps {
  providerSlug: string;
  model: string | null;
  token: string;
  /** Only meaningful with a real (not placeholder) token — see
   *  create-agent-dialog.tsx vs. agent-integration-dialog.tsx. */
  allowTest?: boolean;
}

type TestState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; ok: boolean; message: string };

/**
 * Copy-paste-ready code for pointing a real agent at Tollgate instead of the
 * provider directly, for whichever assistant this agent actually uses. Shown
 * both right after creation (real token, create-agent-dialog.tsx) and from
 * the per-agent Integration view later (placeholder token,
 * agent-integration-dialog.tsx).
 */
export function ConnectAgentSnippet({
  providerSlug,
  model,
  token,
  allowTest = false,
}: ConnectAgentSnippetProps) {
  const [lang, setLang] = useState<"python" | "typescript">("python");
  const [copied, setCopied] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  const snippets = buildConnectSnippets(providerSlug, model, token);
  if (snippets === null) return null;

  const code = snippets[lang];

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Selectable/copyable by hand from the <code> block either way.
    }
  }

  async function handleTest() {
    setTest({ kind: "pending" });
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerSlug, model, token }),
      });
      const body = (await res.json()) as { ok: boolean; message: string };
      setTest({ kind: "done", ok: body.ok, message: body.message });
    } catch {
      setTest({
        kind: "done",
        ok: false,
        message: "Couldn't reach Tollgate to run the test.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Connect your agent</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant={lang === "python" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setLang("python")}
          >
            Python
          </Button>
          <Button
            type="button"
            variant={lang === "typescript" ? "secondary" : "ghost"}
            size="xs"
            onClick={() => setLang("typescript")}
          >
            TypeScript
          </Button>
        </div>
      </div>

      <div className="relative">
        <pre className="max-h-64 overflow-auto rounded-lg border bg-muted px-3 py-2.5 text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute top-2 right-2"
          onClick={handleCopy}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {allowTest && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={test.kind === "pending"}
            onClick={handleTest}
          >
            {test.kind === "pending" ? "Testing…" : "Test connection"}
          </Button>
          {test.kind === "done" && (
            <p
              className={cn("text-xs")}
              style={{ color: test.ok ? "var(--ok)" : "var(--err)" }}
            >
              {test.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
