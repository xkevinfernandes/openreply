"use client";

// DM logs: every comment or DM an automation acted on, from OpenReply's
// GET /api/logs (status filter + pages), in the Review Room table look.

import { useEffect, useState } from "react";
import { dmStatusLabel, dmStatusTone, LOG_FILTERS, logsQuery } from "@/lib/os/settings";

interface LogRow {
  id: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  matchedKeyword: string | null;
  status: string;
  errorMessage: string | null;
  publicReplyError: string | null;
  createdAt: string;
  dmSentAt: string | null;
  automation: { name: string } | null;
  instagramAccount: { username: string } | null;
}

interface Payload {
  logs: LogRow[];
  pagination: { page: number; total: number; totalPages: number };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function LogsPanel() {
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Loading flags for a fetch keyed on the filter: a legitimate effect use.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/logs?${logsQuery(status, page)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((p) => {
        if (cancelled) return;
        if (!p.success) throw new Error(p.error || "Couldn't load the logs.");
        setData(p.data);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load the logs."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [status, page]);

  const total = data?.pagination.total ?? 0;
  const pages = data?.pagination.totalPages ?? 1;

  return (
    <section className="os-set-section" aria-labelledby="os-set-logs">
      <header className="os-set-section-head os-set-section-head-row">
        <div>
          <h2 id="os-set-logs">DM logs</h2>
          <p>Every comment or DM an automation acted on, newest first. Failed rows say why.</p>
        </div>
        <span className="os-set-count">{loading && !data ? "Loading…" : `${total.toLocaleString("en-GB")} ${total === 1 ? "row" : "rows"}`}</span>
      </header>

      <div className="os-segmented os-set-filter" role="group" aria-label="Status">
        {LOG_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={status === f.value}
            onClick={() => {
              setStatus(f.value);
              setPage(1);
            }}
          >
            {f.value !== "all" && <i className="os-set-dot" data-tone={dmStatusTone(f.value)} aria-hidden="true" />}
            {f.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="os-kb-note" data-kind="error" role="alert">
          {error}
        </p>
      ) : data && !data.logs.length ? (
        <p className="os-set-empty">{status === "all" ? "No DMs yet. They show up here as soon as an automation fires." : "Nothing with this status."}</p>
      ) : (
        <div className="os-set-tablewrap" aria-busy={loading}>
          <table className="os-set-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Person</th>
                <th scope="col">Automation</th>
                <th scope="col">Comment</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data?.logs ?? []).map((l) => (
                <tr key={l.id}>
                  <td className="os-set-when">{when(l.createdAt)}</td>
                  <td>
                    <span className="os-set-person">{l.commenterName ? `@${l.commenterName}` : l.commenterId}</span>
                    {l.instagramAccount && <small>to @{l.instagramAccount.username}</small>}
                  </td>
                  <td>
                    {l.automation?.name ?? "–"}
                    {l.matchedKeyword && <small>“{l.matchedKeyword}”</small>}
                  </td>
                  <td className="os-set-comment">{l.commentText}</td>
                  <td>
                    <span className="os-st" data-tone={dmStatusTone(l.status)}>
                      <i />
                      {dmStatusLabel(l.status)}
                    </span>
                    {(l.errorMessage || l.publicReplyError) && <small className="os-set-error">{l.errorMessage || `Public reply: ${l.publicReplyError}`}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="os-set-pager" aria-label="Pages">
          <button type="button" className="os-button" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Newer
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button type="button" className="os-button" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>
            Older
          </button>
        </nav>
      )}
    </section>
  );
}
