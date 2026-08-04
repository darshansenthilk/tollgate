"use client";

import { useCallback, useEffect, useState } from "react";
import { Scissors } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError, listSuggestions, type PromptSuggestion } from "@/lib/api";

/**
 * Token waste Tollgate can see and the customer can't: the static block an
 * agent re-sends on every request.
 *
 * Advisory by design — nothing here changes a prompt or a policy. Tollgate
 * silently trimming a request could change an agent's behaviour in ways its
 * owner can't debug, so the finding goes to a person who decides.
 *
 * Fetched once on mount rather than polled like the other panels: this reads
 * a hundred rows per agent and the answer changes when someone edits their
 * app, not second to second.
 */

function formatMoney(cents: number): string {
  const dollars = cents / 100;
  return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
}

export function SuggestionsPanel() {
  const [suggestions, setSuggestions] = useState<PromptSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSuggestions(await listSuggestions());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load suggestions.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Nothing to say yet is the normal state for a new deployment — stay quiet
  // rather than occupying the page with an empty card.
  if (error === null && suggestions !== null && suggestions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border"
            style={{ borderColor: "var(--line)", backgroundColor: "var(--panel)" }}
          >
            <Scissors className="size-4" style={{ color: "var(--muted-foreground)" }} />
          </span>
          <div>
            <CardTitle>Token savings</CardTitle>
            <CardDescription>
              Text your agents re-send on every request
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error !== null && (
          <p className="text-sm" style={{ color: "var(--err)" }}>
            {error}
          </p>
        )}

        {suggestions === null && error === null && (
          <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
            Checking…
          </p>
        )}

        {suggestions?.map((s) => (
          <div
            key={s.agentId}
            className="flex flex-col gap-2 rounded-lg border p-3"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="text-sm">
              <span className="font-medium">{s.agentName}</span> repeats the same{" "}
              <span className="font-medium">
                ~{s.repeatedTokens.toLocaleString()} tokens
              </span>{" "}
              in {Math.round(s.frequency * 100)}% of its last{" "}
              {s.sampledRequests} requests
              {s.wasteCents !== null && (
                <>
                  {" "}
                  — about{" "}
                  <span className="font-medium" style={{ color: "var(--amber)" }}>
                    {formatMoney(s.wasteCents)}
                  </span>{" "}
                  across those requests
                </>
              )}
              .
            </p>

            <pre
              className="max-h-24 overflow-auto rounded-lg border bg-muted/50 p-2 text-xs break-words whitespace-pre-wrap"
              style={{ borderColor: "var(--line)" }}
            >
              {s.sample}
            </pre>

            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {/* The actionable half. A repeated PREFIX is nearly always a
                  preamble stuffed with reference data, which is what
                  retrieval is for; a repeated SUFFIX is usually a trailing
                  instruction that just needs shortening. */}
              {s.position === "prefix"
                ? "Sent ahead of every request. If it's reference data, fetch only the rows each request needs instead of inlining all of it."
                : "Appended to every request. If it's a standing instruction, shorten it — it's charged in full every call."}{" "}
              Token counts are estimates.
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
