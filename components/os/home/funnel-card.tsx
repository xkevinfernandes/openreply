"use client";

// Home's funnel (dm-crm 031): the cohort left to right, count and share of
// the step before (worded as on the All · funnel board), people flowing through as dots that drop out where the funnel drops
// (hidden under reduced motion), then "From this cohort" and "Closed in
// period" in the workspace currency, and the wins still missing an amount.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import "./home-funnel.css";
import { markFunnelWon } from "@/app/(os)/os/pipeline/all/actions";
import WonPicker from "@/components/os/contacts/won-picker";
import { useFunnelWindow } from "@/components/os/pipeline/use-funnel-window";
import { InfoTip } from "@/components/os/ui/info-tip";
import { formatMoney } from "@/lib/os/money";
import type { FunnelWindow } from "@/lib/os/crm-funnel";
import { flowDots, windowFrom as windowStart, windowLabel as cohortLabel, type HomeFunnelData } from "@/lib/os/home-funnel-view";

const heightOf = (max: number) => (n: number) => (max ? Math.max(14, Math.round((n / max) * 100)) : 14);

/** "DMs in" keeps its capitals; "Replied" → "replied". */
const lower = (label: string) => (/^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

const shortDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** `window` is Home's one period switch; the All · funnel board opens on the same window. */
export function FunnelCard({ data, now, window: win }: { data: HomeFunnelData; now: string; window: FunnelWindow }) {
  const [stored, setStored] = useFunnelWindow();
  useEffect(() => {
    if (stored !== win) setStored(win);
  }, [stored, win, setStored]);
  const [listOpen, setListOpen] = useState(false);
  const [filling, setFilling] = useState<string | null>(null);
  const router = useRouter();
  const view = data.views[win];
  const counts = view.steps.map((s) => s.count);
  const h = heightOf(counts[0]);
  const dots = flowDots(counts, h);
  const money = (n: number) => formatMoney(n, data.currency);
  const missing = data.noAmount.filter((n) => view.revenue.noAmount.includes(n.id));
  const showNote = windowStart(win, new Date(now)) < new Date(data.stageLogSince);
  const fill = filling ? data.noAmount.find((n) => n.id === filling) : null;

  return (
    <section aria-labelledby="os-home-funnel" className="os-home-sec os-fn">
      <div className="os-fn-head">
        <div>
          <h2 id="os-home-funnel" className="os-h2">
            Funnel
          </h2>
          <p>
            {cohortLabel(win)}
            <InfoTip label="Who is counted">Sales and Unsorted only. Personal, Pitches, spam and imports are left out. Each step counts people who reached it or any later step.</InfoTip>
          </p>
        </div>
      </div>

      <div className="os-fn-scroll">
        <div className="os-fn-shape" aria-hidden="true">
          {view.steps.map((s, i) => {
            const a = h(s.count);
            const b = i < counts.length - 1 ? h(counts[i + 1]) : a;
            const t1 = (100 - a) / 2;
            const t2 = (100 - b) / 2;
            return (
              <div key={s.key} className="os-fn-seg">
                <span data-last={i === counts.length - 1 || undefined} style={{ clipPath: `polygon(0% ${t1}%, 100% ${t2}%, 100% ${100 - t2}%, 0% ${100 - t1}%)` }} />
              </div>
            );
          })}
          <div className="os-fn-dots">
            {dots.map((d, i) => (
              <i key={i} style={{ top: `${d.top.toFixed(1)}%`, ["--end" as string]: `${d.end.toFixed(1)}%`, ["--dur" as string]: `${d.dur.toFixed(2)}s`, ["--delay" as string]: `${d.delay.toFixed(2)}s` }} />
            ))}
          </div>
        </div>
        <ol className="os-fn-steps">
          {view.steps.map((s, i) => (
            <li key={s.key} data-last={i === counts.length - 1 || undefined}>
              <span className="lbl">{s.label}</span>
              <span className="n">{s.count.toLocaleString("en-GB")}</span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${counts[0] ? Math.max(2, Math.round((s.count / counts[0]) * 100)) : 0}%` }} />
              </span>
              <span className="drop">{i === 0 ? "in the window" : s.pctOfPrevious === null ? "—" : `${s.pctOfPrevious}% of ${lower(view.steps[i - 1].label)}`}</span>
            </li>
          ))}
        </ol>
      </div>

      {view.empty ? <p className="os-fn-empty">No one new in the last {win} days</p> : null}

      <div className="os-fn-money">
        <div className="os-fn-tile" data-feature>
          <span className="lbl">From this cohort</span>
          <span className="n">{money(view.revenue.fromCohort)}</span>
          <span className="foot">Won by people who first reached you in these {win} days</span>
        </div>
        <div className="os-fn-tile">
          <span className="lbl">Closed in period</span>
          <span className="n">{money(view.revenue.closedInPeriod)}</span>
          <span className="foot">Won in these {win} days, whenever they first reached you</span>
        </div>
        {missing.length ? (
          <button type="button" className="os-fn-tile os-fn-missing" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen}>
            <span className="os-fn-pill">
              {missing.length} won with no amount
            </span>
            <span className="foot">Not in either figure · fill in</span>
          </button>
        ) : null}
      </div>

      {listOpen && missing.length ? (
        <ul className="os-fn-list" aria-label="Won with no amount">
          {missing.map((m) => (
            <li key={m.id}>
              <span>
                <strong>{m.name}</strong> · won {shortDate(m.wonAt)}
              </span>
              <button type="button" className="os-button" onClick={() => setFilling(m.id)}>
                Add amount
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {showNote ? <p className="os-fn-note">Qualified counts stage history since {shortDate(data.stageLogSince)}, plus anyone who reached a later step.</p> : null}

      {fill ? (
        <WonPicker
          contactIds={[fill.id]}
          who={fill.name}
          submitLabel="Save"
          onClose={() => setFilling(null)}
          save={(offer, amount) => markFunnelWon(fill.id, offer, amount, fill.wonAt)}
          onDone={() => {
            setFilling(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}
