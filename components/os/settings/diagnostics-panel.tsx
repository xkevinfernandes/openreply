"use client";

// Settings › Diagnostics: one health list (Instagram account, webhook, queue,
// worker, Zernio, Kit, Cal.com) from /api/os/diagnostics. Check again runs
// every row on its own, so a slow one doesn't hold the others. The old detail
// lists sit folded under Details.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { InfoTip } from "@/components/os/ui";
import { CHECK_KEYS, CHECK_NAMES, checkedLabel, diagnosticsSummary, type CheckKey, type CheckRow } from "@/lib/os/diagnostics";
import { ago, dmStatusLabel } from "@/lib/os/settings";

type Row = CheckRow | { key: CheckKey; name: string; tone: "checking"; line: string; next: [] };

/** The shared detail reads, as JSON. */
interface Details {
  queueCounts: Record<string, number>;
  workerHealth: { healthy: boolean; ageMs: number | null; heartbeat: { checkedAt: string; hostname?: string } | null };
  workerAlerts: { level: string; message: string; createdAt: string }[];
  webhookFailures: { id: string; object: string | null; errorMessage: string | null; createdAt: string }[];
  dmFailures: { id: string; status: string; commentText: string; errorMessage: string | null; updatedAt: string; automation: { name: string } }[];
  tokenRefreshFailures: { id: string; message: string; createdAt: string }[];
  operationalEvents: { id: string; source: string; level: string; message: string; createdAt: string }[];
}

const checking = (key: CheckKey): Row => ({ key, name: CHECK_NAMES[key], tone: "checking", line: "Checking…", next: [] });

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function fetchChecks(query: string): Promise<{ checks: CheckRow[]; sending: { sent: number; cap: number } | null; details: Details | null }> {
  const res = await fetch(`/api/os/diagnostics${query}`, { cache: "no-store" });
  const p = await res.json().catch(() => null);
  if (!res.ok || !p?.success) throw new Error(p?.error || "The check failed.");
  return p.data;
}

export default function DiagnosticsPanel() {
  const [rows, setRows] = useState<Row[]>(() => CHECK_KEYS.map(checking));
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState<{ sent: number; cap: number } | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [detailsState, setDetailsState] = useState<"idle" | "loading" | "error">("idle");

  const setRow = (r: Row) => setRows((list) => list.map((x) => (x.key === r.key ? r : x)));

  const checkAll = useCallback(() => {
    setRows(CHECK_KEYS.map(checking));
    setCheckedAt(null);
    let left = CHECK_KEYS.length;
    const done = () => {
      left -= 1;
      if (!left) {
        setCheckedAt(Date.now());
        setNow(Date.now());
      }
    };
    for (const key of CHECK_KEYS) {
      fetchChecks(`?only=${key}&fresh=1`)
        .then((d) => d.checks[0] && setRow(d.checks[0]))
        .catch(() => setRow({ key, name: CHECK_NAMES[key], tone: "warn", line: "Couldn't check. Try again.", next: [] }))
        .finally(done);
    }
  }, []);

  useEffect(() => {
    // First load: one request for the whole list and today's sends.
    let live = true;
    fetchChecks("")
      .then((d) => {
        if (!live) return;
        setRows(d.checks);
        setSending(d.sending);
        setCheckedAt(Date.now());
        setNow(Date.now());
      })
      .catch(() => live && checkAll());
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live = false;
      window.clearInterval(tick);
    };
  }, [checkAll]);

  const busy = rows.some((r) => r.tone === "checking");
  const summary = diagnosticsSummary(rows.filter((r): r is CheckRow => r.tone !== "checking"));

  return (
    <div className="os-set-stack os-dg">
      <section className="os-set-section" aria-labelledby="os-dg-title">
        <header className="os-dg-head">
          <div>
            <h2 id="os-dg-title">Is everything working?</h2>
            <p role="status">{busy ? "Checking…" : `${checkedLabel(checkedAt, now)} · ${summary.problems ? summary.text : "no problems"}`}</p>
          </div>
          <button type="button" className="os-button" onClick={checkAll} disabled={busy}>
            {busy ? "Checking…" : "Check again"}
          </button>
        </header>
        <ul className="os-dg-list">
          {rows.map((r) => (
            <li key={r.key} className="os-dg-row" data-key={r.key} data-tone={r.tone} aria-busy={r.tone === "checking" || undefined}>
              <i className="os-dg-dot" aria-hidden="true" />
              <span className="os-dg-text">
                <strong>{r.name}</strong>
                <span>{r.line}</span>
              </span>
              {r.next.length ? (
                <span className="os-dg-next">
                  {r.next.map((n) =>
                    n.href ? (
                      n.href.startsWith("http") ? (
                        <a key={n.label} className="os-button" href={n.href} target="_blank" rel="noreferrer">
                          {n.label}
                        </a>
                      ) : (
                        <Link key={n.label} className="os-button" href={n.href}>
                          {n.label}
                        </Link>
                      )
                    ) : (
                      <span key={n.label} className="os-dg-hint">
                        {n.label}
                      </span>
                    )
                  )}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {sending ? (
        <section className="os-set-section os-dg-send" aria-labelledby="os-dg-send">
          <h2 id="os-dg-send">
            Sending today
            <InfoTip label="What counts?">All sends count, the current rule, except your own replies from the composer, which never count and are never blocked. Messages here are bubbles, not people.</InfoTip>
          </h2>
          <p>
            <strong>
              {sending.sent} / {sending.cap}
            </strong>{" "}
            sent today
          </p>
        </section>
      ) : null}

      <details
        className="os-set-section os-dg-details"
        onToggle={(e) => {
          if (!(e.currentTarget as HTMLDetailsElement).open || details || detailsState === "loading") return;
          setDetailsState("loading");
          fetchChecks("?only=queue&details=1")
            .then((d) => {
              setDetails(d.details);
              setDetailsState(d.details ? "idle" : "error");
            })
            .catch(() => setDetailsState("error"));
        }}
      >
        <summary>Details</summary>
        {detailsState === "loading" ? <p className="os-set-empty">Loading…</p> : null}
        {detailsState === "error" ? <p className="os-set-empty">No details: the queue didn&apos;t answer, or this is sample data.</p> : null}
        {details ? <DetailLists data={details} /> : null}
      </details>
    </div>
  );
}

function List<T extends { id?: string }>({ title, items, empty, render }: { title: string; items: T[]; empty: string; render: (item: T) => React.ReactNode }) {
  return (
    <div className="os-dg-sub" aria-label={title}>
      <h3>{title}</h3>
      {!items.length ? (
        <p className="os-set-empty">{empty}</p>
      ) : (
        <ul className="os-set-events">
          {items.map((item, i) => (
            <li key={item.id ?? i}>{render(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetailLists({ data }: { data: Details }) {
  const q = data.queueCounts;
  return (
    <div className="os-dg-detail">
      <p className="os-set-empty">
        Worker {data.workerHealth.healthy ? "running" : "down"}
        {data.workerHealth.heartbeat ? ` · checked in ${ago(data.workerHealth.ageMs)}` : " · no heartbeat"} · {q.waiting ?? 0} waiting · {q.active ?? 0} sending · {q.delayed ?? 0} scheduled · {q.failed ?? 0}{" "}
        failed
      </p>
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
          ...data.workerAlerts.map((a, i) => ({ id: `alert-${i}`, level: a.level.toUpperCase(), source: "Worker", message: a.message, createdAt: a.createdAt })),
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
    </div>
  );
}
