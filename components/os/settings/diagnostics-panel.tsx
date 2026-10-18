"use client";

// Diagnostics: worker heartbeat, queue counts and recent failures, from
// OpenReply's GET /api/admin/diagnostics, with a one-line verdict on top.

import { useCallback, useEffect, useState } from "react";
import { ago, diagnosticsVerdict, dmStatusLabel } from "@/lib/os/settings";

interface Diagnostics {
  queueCounts: Record<string, number>;
  workerHealth: { healthy: boolean; ageMs: number | null; heartbeat: { checkedAt: string; hostname?: string; pid: number; startedAt?: string } | null };
  workerAlerts: { level: string; message: string; createdAt: string }[];
  webhookFailures: { id: string; object: string | null; errorMessage: string | null; createdAt: string }[];
  dmFailures: { id: string; status: string; commentText: string; errorMessage: string | null; updatedAt: string; automation: { name: string } }[];
  tokenRefreshFailures: { id: string; message: string; createdAt: string }[];
  operationalEvents: { id: string; source: string; level: string; message: string; createdAt: string; resolvedAt: string | null }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const QUEUE = [
  ["waiting", "Waiting"],
  ["active", "Sending"],
  ["delayed", "Scheduled"],
  ["failed", "Failed"],
] as const;

function List<T extends { id?: string; createdAt?: string }>({
  title,
  items,
  empty,
  render,
}: {
  title: string;
  items: T[];
  empty: string;
  render: (item: T) => React.ReactNode;
}) {
  return (
    <section className="os-set-section" aria-label={title}>
      <header className="os-set-section-head">
        <h2>{title}</h2>
      </header>
      {!items.length ? (
        <p className="os-set-empty">{empty}</p>
      ) : (
        <ul className="os-set-events">
          {items.map((item, i) => (
            <li key={item.id ?? `${item.createdAt}-${i}`}>{render(item)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function DiagnosticsPanel() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // The route waits on Redis; don't hang forever if it's unreachable.
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch("/api/admin/diagnostics", { cache: "no-store", signal: ctrl.signal });
      const p = await res.json().catch(() => null);
      if (!res.ok || !p?.success) throw new Error(p?.error || "The diagnostics check failed. Usually the queue (Redis) is unreachable.");
      setData(p.data);
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "AbortError"
          ? "No answer from the queue (Redis) after 12 seconds. The worker and DMs can't run without it."
          : e instanceof Error
            ? e.message
            : "The diagnostics check failed."
      );
    } finally {
      window.clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; load() sets its own loading flags.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const verdict = data
    ? diagnosticsVerdict({
        workerHealthy: data.workerHealth.healthy,
        workerAgeMs: data.workerHealth.ageMs,
        queue: data.queueCounts,
        webhookFailures: data.webhookFailures.length,
        dmFailures: data.dmFailures.length,
        tokenRefreshFailures: data.tokenRefreshFailures.length,
      })
    : null;

  return (
    <div className="os-set-stack">
      <div className="os-set-verdict" data-tone={error ? "bad" : (verdict?.tone ?? "quiet")} role="status">
        <i aria-hidden="true" />
        <span>{error ?? verdict?.text ?? "Checking the worker and the queue…"}</span>
        <button type="button" className="os-button" onClick={() => void load()} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>

      {data && (
        <>
          <div className="os-stats os-set-stats">
            <div className="os-stat">
              <div className="label">Worker</div>
              <div className="value os-set-stat-word">{data.workerHealth.healthy ? "Running" : "Down"}</div>
              <div className="os-set-stat-sub">
                {data.workerHealth.heartbeat
                  ? `Checked in ${ago(data.workerHealth.ageMs)}${data.workerHealth.heartbeat.hostname ? ` · ${data.workerHealth.heartbeat.hostname}` : ""}`
                  : "No heartbeat"}
              </div>
            </div>
            {QUEUE.map(([key, label]) => (
              <div className="os-stat" key={key} data-alert={key === "failed" && (data.queueCounts[key] ?? 0) > 0 ? "true" : undefined}>
                <div className="label">{label}</div>
                <div className="value">{(data.queueCounts[key] ?? 0).toLocaleString("en-GB")}</div>
              </div>
            ))}
          </div>

          <List
            title="DMs that didn't send"
            items={data.dmFailures}
            empty="None recently."
            render={(f) => (
              <>
                <span className="os-set-event-top">
                  <strong>{f.automation.name}</strong>
                  <span>{dmStatusLabel(f.status)}</span>
                  <time>{when(f.updatedAt)}</time>
                </span>
                <span className="os-set-event-body">{f.errorMessage || f.commentText}</span>
              </>
            )}
          />
          <List
            title="Webhook failures"
            items={data.webhookFailures}
            empty="None. Instagram events are being processed."
            render={(f) => (
              <>
                <span className="os-set-event-top">
                  <strong>{f.object ?? "Event"}</strong>
                  <time>{when(f.createdAt)}</time>
                </span>
                <span className="os-set-event-body">{f.errorMessage ?? "No error message"}</span>
              </>
            )}
          />
          <List
            title="Worker alerts and system events"
            items={[
              ...data.tokenRefreshFailures.map((t) => ({ id: t.id, level: "ERROR", source: "Token refresh", message: t.message, createdAt: t.createdAt })),
              ...data.workerAlerts.map((a) => ({ id: undefined, level: a.level.toUpperCase(), source: "Worker", message: a.message, createdAt: a.createdAt })),
              ...data.operationalEvents.map((e) => ({ id: e.id, level: e.level, source: e.source.toLowerCase().replace("_", " "), message: e.message, createdAt: e.createdAt })),
            ]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 20)}
            empty="Nothing logged."
            render={(e) => (
              <>
                <span className="os-set-event-top">
                  <span className="os-st" data-tone={e.level === "ERROR" ? "bad" : e.level === "WARNING" ? "wait" : "quiet"}>
                    <i />
                    {e.source}
                  </span>
                  <time>{when(e.createdAt)}</time>
                </span>
                <span className="os-set-event-body">{e.message}</span>
              </>
            )}
          />
        </>
      )}
    </div>
  );
}
