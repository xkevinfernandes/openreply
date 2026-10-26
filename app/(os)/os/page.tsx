// Home (Main board): greeting, "Review N drafts ⏎", the outcome row with
// Today / 7d / 30d, the pipeline per setter, Yours to do and Setters.

import Link from "next/link";
import ReviewButton from "@/components/os/home/review-button";
import TodoCheck from "@/components/os/home/todo-check";
import { auth, getCurrentWorkspaceId } from "@/lib/auth";
import { broadcastTodos, greeting, homeDate, loadPipeline, workflowTodos, type HomeTodo } from "@/lib/os/home";
import { loadOutcomes, parsePeriod, PERIODS, type OutcomeCell, type Period } from "@/lib/os/metrics";
import { loadHomeFollowups } from "@/lib/os/sequences/view";
import { getWorkspaceSettings } from "@/lib/os/workspace-settings";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ period?: string; setter?: string }> };

const quiet = <T,>(label: string, p: Promise<T>, fallback: T) =>
  p.catch((err) => {
    console.error(`[OS Home] ${label}:`, err instanceof Error ? err.message : err);
    return fallback;
  });

function href(period: Period, setter: string | null) {
  const q = new URLSearchParams();
  if (period !== "7d") q.set("period", period);
  if (setter) q.set("setter", setter);
  const s = q.toString();
  return s ? `/os?${s}` : "/os";
}

// Short tile labels so seven tiles fit one row at desktop width; the full
// step name stays in the tile's title.
const SHORT: Partial<Record<OutcomeCell["kind"], string>> = {
  keyword_trigger: "Triggers",
  conversation_started: "Conversations",
  lead_magnet_sent: "Lead magnets",
  offer_made: "Offers made",
};

// The foot names the step the % is taken from, in one short word.
const FOOT: Partial<Record<OutcomeCell["kind"], string>> = {
  keyword_trigger: "triggers",
  conversation_started: "chats",
  lead_magnet_sent: "magnets",
  offer_made: "offers",
  call_booked: "calls",
  showed: "shows",
};

// The one sage tile on Home: the outcome the setter exists for.
const FEATURE: OutcomeCell["kind"] = "call_booked";

function Outcomes({ cells }: { cells: OutcomeCell[] }) {
  return (
    <ol className="os-home-outcomes">
      {cells.map((c, i) => (
        <li key={c.kind} data-feature={c.kind === FEATURE || undefined} title={c.pct === null || i === 0 ? c.label : `${c.label}: ${c.pct}% of ${cells[i - 1].label.toLowerCase()}`}>
          <span className="lbl">{SHORT[c.kind] ?? c.label}</span>
          <span className="n">{c.n.toLocaleString("en-GB")}</span>
          <span className="pct">{c.pct === null ? "—" : i > 0 ? `${c.pct}% of ${FOOT[cells[i - 1].kind] ?? cells[i - 1].label.toLowerCase()}` : `${c.pct}%`}</span>
        </li>
      ))}
    </ol>
  );
}

interface TodoRow {
  id: string;
  label: React.ReactNode;
  due: string;
  tone: HomeTodo["tone"];
  href?: string;
  taskId?: string;
  name: string;
}

const who = (p: { username: string | null; fullName: string | null }) => p.username ?? p.fullName ?? "them";

export default async function OsHome({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const params = await searchParams;
  const period = parsePeriod(params.period);
  const now = new Date();

  const [session, settings] = await Promise.all([auth(), quiet("settings", getWorkspaceSettings(workspaceId), null)]);
  const tz = settings?.timezone ?? "Europe/Luxembourg";
  const first = session?.user?.name?.trim().split(/\s+/)[0];

  const [outcomes, pipe, followups, broadcasts] = await Promise.all([
    quiet("outcomes", loadOutcomes(workspaceId, period, tz, now), null),
    quiet("pipeline", loadPipeline(workspaceId, params.setter ?? null), null),
    quiet("follow-ups", loadHomeFollowups(workspaceId, now), null),
    quiet("broadcasts", Promise.all([broadcastTodos(workspaceId, now), workflowTodos(workspaceId, now)]).then((x) => x.flat()), [] as HomeTodo[]),
  ]);

  const todos: TodoRow[] = [
    ...(followups?.attendance ?? []).map((a) => ({
      id: `call:${a.bookingId}`,
      name: who(a),
      label: (
        <>
          Did <strong>{who(a)}</strong> show?
        </>
      ),
      due: "Mark",
      tone: "warn" as const,
      href: "/os/follow-ups",
    })),
    ...(followups?.tasks ?? []).map((t) => ({
      id: `task:${t.id}`,
      taskId: t.id,
      name: t.title,
      label: (
        t.username && t.title.includes(t.username) ? (
          t.title
        ) : (
          <>
            {t.title} · <strong>{who(t)}</strong>
          </>
        )
      ),
      due: "—",
      tone: "muted" as const,
    })),
    ...broadcasts.map((b) => ({
      id: b.id,
      name: `${b.label} ${b.strong}`,
      label: (
        <>
          {b.label} <strong>{b.strong}</strong>
        </>
      ),
      due: b.due,
      tone: b.tone,
      href: b.href,
    })),
  ];

  const max = Math.max(1, ...(pipe?.pipeline.rows.map((r) => r.count) ?? [1]));
  const selected = pipe?.pipeline.selected ?? null;

  return (
    <div className="os-home">
      <header className="os-home-head">
        <div>
          <h1 className="os-title">
            {greeting(now, tz)}
            {first ? `, ${first}` : ""}
          </h1>
          <p>{homeDate(now, tz)}</p>
        </div>
        <div className="os-home-actions">
          <nav className="os-home-seg" aria-label="Period">
            {PERIODS.map((p) => (
              <Link key={p.key} href={href(p.key, params.setter ?? null)} aria-current={p.key === period ? "page" : undefined} scroll={false}>
                {p.label}
              </Link>
            ))}
          </nav>
          <ReviewButton count={pipe?.draftsWaiting ?? 0} />
        </div>
      </header>

      <section aria-label="Outcomes" className="os-home-tiles">
        {outcomes ? <Outcomes cells={outcomes} /> : <p className="os-home-err">Numbers didn&apos;t load.</p>}
      </section>

      <div className="os-home-cols">
        <section aria-labelledby="os-home-pipe" className="os-home-sec os-home-main">
          <div className="os-home-sechead">
            <h2 id="os-home-pipe" className="os-h2">Pipeline by stage</h2>
            {pipe && pipe.pipeline.setters.length > 1 ? (
              <nav className="os-home-seg" aria-label="Setter">
                {pipe.pipeline.setters.map((s) => (
                  <Link key={s.id} href={href(period, s.id)} aria-current={s.id === selected ? "page" : undefined} scroll={false}>
                    <span className="os-home-av" data-on={s.id === selected || undefined} aria-hidden="true">
                      {s.name.charAt(0).toUpperCase()}
                    </span>
                    {s.name}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
          {pipe ? (
            <div className="os-home-box">
              {pipe.pipeline.rows.map((r) => (
                <Link key={r.key} href={`/os/contacts?stage=${encodeURIComponent(r.key)}${selected ? `&setter=${selected}` : ""}`} className="os-home-stage" data-zero={r.count === 0 || undefined}>
                  <span className="lbl">{r.label}</span>
                  <span className="track" aria-hidden="true">
                    <span style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                  </span>
                  <span className="n">{r.count}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="os-home-err">Pipeline didn&apos;t load.</p>
          )}
        </section>

        <div className="os-home-side">
          <section aria-labelledby="os-home-todo" className="os-home-sec">
            <div className="os-home-sechead">
              <h2 id="os-home-todo" className="os-h2">Yours to do</h2>
              <Link href="/os/follow-ups" className="os-home-more">
                All follow-ups
              </Link>
            </div>
            {todos.length ? (
              <ul className="os-home-box os-home-todos">
                {todos.map((t) => (
                  <li key={t.id}>
                    {t.taskId ? <TodoCheck taskId={t.taskId} label={`Done: ${t.name}`} /> : <input type="checkbox" className="os-home-todo-dot" aria-hidden="true" tabIndex={-1} disabled />}
                    {t.href ? (
                      <Link href={t.href} className="lbl">
                        {t.label}
                      </Link>
                    ) : (
                      <span className="lbl">{t.label}</span>
                    )}
                    <span className="due" data-tone={t.tone}>
                      {t.due}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="os-home-none">Nothing for you right now.</p>
            )}
          </section>

          <section aria-labelledby="os-home-setters" className="os-home-sec">
            <div className="os-home-sechead">
              <h2 id="os-home-setters" className="os-h2">Setters</h2>
              <Link href="/os/knowledge" className="os-home-more">
                Knowledge bases
              </Link>
            </div>
            <div className="os-home-box">
              {(pipe?.cards ?? []).map((s, i) => (
                <Link key={s.id} href={`/os/knowledge/${s.id}`} className="os-home-setter">
                  <span className="os-home-av" data-size="24" data-on={i === 0 || undefined} aria-hidden="true">
                    {s.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="name">
                    <strong>{s.name}</strong>
                    <span> · {s.open} open</span>
                  </span>
                  {s.drafts ? (
                    <span className="meta" data-tone="warn">
                      {s.drafts} draft{s.drafts === 1 ? "" : "s"}
                    </span>
                  ) : (
                    <span className="meta">{s.mode}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
