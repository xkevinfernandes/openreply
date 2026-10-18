"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import {
  connectCalendar,
  disconnectCalendar,
  loadEventTypes,
  previewTimes,
  saveCalendarSettings,
  setCalendarEnabled,
  testCalendar,
  type CalendarActionResult,
} from "@/app/(os)/os/integrations/calendar-actions";
import { shortAgo } from "@/lib/os/labels";
import { CALENDAR_INFO, WEEKDAY_LABELS } from "@/lib/os/integrations/calendar/info";
import { DEFAULT_SETTER_KEY, type CalendarSettings } from "@/lib/os/integrations/calendar/settings";
import type { CalendarEventType } from "@/lib/os/integrations/calendar/types";
import type { CalendarView } from "@/lib/os/integrations/calendar/view";

type Message = { kind: "error" | "notice"; text: string } | null;

function Logo({ provider }: { provider: CalendarView["provider"] }) {
  return (
    <span className="os-int-logo" data-provider={provider} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <rect x="4" y="5.5" width="16" height="14" rx="2.5" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        {provider === "calcom" ? <path d="m9.5 14.5 1.8 1.8 3.4-3.6" /> : <circle cx="12" cy="15" r="2.2" />}
      </svg>
    </span>
  );
}

function status(v: CalendarView): { tone: "good" | "warn" | "bad" | "off"; label: string } {
  if (!v.connected) return { tone: "off", label: "Not connected" };
  if (v.lastError) return { tone: "bad", label: "Needs attention" };
  if (!v.enabled) return { tone: "warn", label: "Not booking" };
  if (!v.settings.eventTypes[DEFAULT_SETTER_KEY] && !Object.keys(v.settings.eventTypes).length) return { tone: "warn", label: "Pick an event type" };
  return { tone: "good", label: "J books here" };
}

const HOURS = Array.from({ length: 25 }, (_, h) => h);
const hourLabel = (h: number) => (h === 0 || h === 24 ? "12am" : h === 12 ? "12pm" : h < 12 ? `${h}am` : `${h - 12}pm`);

export default function CalendarCard({
  view,
  setters,
  canManage,
  now,
}: {
  view: CalendarView;
  setters: { id: string; name: string }[];
  canManage: boolean;
  now: number;
}) {
  const info = CALENDAR_INFO[view.provider];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const panelId = useId();
  const explainId = useId();
  const st = status(view);

  function act(fn: () => Promise<CalendarActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setMessage({ kind: "error", text: r.error });
      else if (r.notice) setMessage({ kind: "notice", text: r.notice });
      router.refresh();
    });
  }

  return (
    <article className="os-int-card" data-open={open} aria-labelledby={`${panelId}-name`}>
      <div className="os-int-card-top">
        <Logo provider={view.provider} />
        <h2 id={`${panelId}-name`}>{info.name}</h2>
        <span className="os-st" data-tone={st.tone}>
          <i />
          {st.label}
        </span>
      </div>
      <p className="os-int-blurb">{info.blurb}</p>

      <div className="os-int-actions">
        {canManage && (
          <button
            type="button"
            className={`os-button ${view.connected ? "" : "primary"}`}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Done" : view.connected ? "Manage" : "Connect"}
          </button>
        )}
        <button
          type="button"
          className="os-button ghost os-int-why"
          aria-expanded={explainOpen}
          aria-controls={explainId}
          onClick={() => setExplainOpen((o) => !o)}
        >
          <span className="q" aria-hidden="true">?</span>
          What does this do?
        </button>
        {view.connected && view.booked > 0 && !open && (
          <span className="os-int-meta">
            {view.booked} booked{view.upcoming ? ` · ${view.upcoming} coming up` : ""}
          </span>
        )}
      </div>

      <div className="os-int-reveal" id={explainId} data-open={explainOpen}>
        <div>
          <ul className="os-int-explain">
            {info.explain.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>

      {open && canManage && (
        <div className="os-int-panel" id={panelId}>
          {message && (
            <p className={`os-int-msg ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
              {message.text}
            </p>
          )}
          <section className="os-int-section" aria-label="Connection">
            <h3>Connection</h3>
            <Connection view={view} now={now} pending={pending} onAct={act} />
          </section>
          {view.connected && (
            <>
              <section className="os-int-section" aria-label="Booking">
                <h3>Booking in the DM</h3>
                <div className="os-int-row">
                  <div className="os-int-row-main">
                    <strong>J books on {info.name}</strong>
                    <span>
                      {view.enabled
                        ? "J offers real times and your Approve books them. Off: J sends your booking link instead."
                        : "Off: J sends your booking link. On switches the other calendar off."}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="os-switch"
                    aria-checked={view.enabled}
                    aria-label={`J books on ${info.name}`}
                    disabled={pending}
                    onClick={() => act(() => setCalendarEnabled(view.provider, !view.enabled))}
                  >
                    <span className="os-switch-knob" />
                  </button>
                </div>
                {view.provider === "calendly" && !view.settings.directBooking && (
                  <p className="os-int-hint os-cal-warn">
                    Calendly refused a booking from the API: that needs a paid plan (Standard or above). Until you upgrade, J sends a link that opens
                    exactly the time they picked, with their name and email filled in. Reconnect after upgrading to book directly again.
                  </p>
                )}
              </section>
              <SettingsEditor key={JSON.stringify(view.settings)} view={view} setters={setters} pending={pending} onAct={act} />
            </>
          )}
        </div>
      )}
    </article>
  );
}

interface ConnectionProps {
  view: CalendarView;
  now: number;
  pending: boolean;
  onAct: (fn: () => Promise<CalendarActionResult>) => void;
}

function Connection({ view, now, pending, onAct }: ConnectionProps) {
  const info = CALENDAR_INFO[view.provider];
  const [token, setToken] = useState("");
  const id = useId();
  if (!view.connected) {
    return (
      <form
        className="os-int-form"
        onSubmit={(e) => {
          e.preventDefault();
          onAct(async () => {
            const r = await connectCalendar(view.provider, token);
            if (!r.error) setToken("");
            return r;
          });
        }}
      >
        <label className="os-field" htmlFor={`${id}-token`}>
          <span>{info.tokenLabel}</span>
          <input
            id={`${id}-token`}
            className="os-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={info.placeholder}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
          />
        </label>
        <p className="os-int-hint">{info.tokenHint}</p>
        <button className="os-button primary" disabled={pending || token.trim().length < 10}>
          {pending ? "Testing…" : "Test and connect"}
        </button>
      </form>
    );
  }
  return (
    <div className="os-int-row">
      <div className="os-int-row-main">
        <strong>{view.settings.accountName ? `Connected as ${view.settings.accountName}` : "Key saved"}</strong>
        {view.lastError ? (
          <span className="os-int-bad">{view.lastError}</span>
        ) : view.lastTestedAt ? (
          <span>Tested {shortAgo(view.lastTestedAt, now)} ago.</span>
        ) : null}
      </div>
      <div className="os-int-inline">
        <button type="button" className="os-button" disabled={pending} onClick={() => onAct(() => testCalendar(view.provider))}>
          Test connection
        </button>
        <button
          type="button"
          className="os-button ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Disconnect ${info.name}? J goes back to sending your booking link. Calls already booked stay booked.`))
              onAct(() => disconnectCalendar(view.provider));
          }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function SettingsEditor({
  view,
  setters,
  pending,
  onAct,
}: {
  view: CalendarView;
  setters: { id: string; name: string }[];
  pending: boolean;
  onAct: (fn: () => Promise<CalendarActionResult>) => void;
}) {
  const [s, setS] = useState<CalendarSettings>(view.settings);
  const [types, setTypes] = useState<CalendarEventType[] | null>(null);
  const [typesError, setTypesError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ times: string[]; offered: string[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const id = useId();
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [] as string[];
    }
  }, []);

  useEffect(() => {
    let live = true;
    loadEventTypes(view.provider).then((r) => {
      if (!live) return;
      if (r.error) setTypesError(r.error);
      else setTypes(r.types ?? []);
    });
    return () => {
      live = false;
    };
  }, [view.provider]);

  const rows = [{ id: DEFAULT_SETTER_KEY, name: setters.length ? "Every other setter" : "J's calls" }, ...setters];
  const set = <K extends keyof CalendarSettings>(k: K, v: CalendarSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));

  function pickType(setterKey: string, typeId: string) {
    setS((prev) => {
      const eventTypes = { ...prev.eventTypes };
      if (typeId) eventTypes[setterKey] = typeId;
      else delete eventTypes[setterKey];
      const t = types?.find((x) => x.id === typeId);
      const eventTypeInfo = t ? { ...prev.eventTypeInfo, [t.id]: { name: t.name, durationMinutes: t.durationMinutes } } : prev.eventTypeInfo;
      return { ...prev, eventTypes, eventTypeInfo };
    });
  }

  function toggleDay(d: number) {
    setS((prev) => {
      const has = prev.workDays.includes(d);
      const workDays = has ? prev.workDays.filter((x) => x !== d) : [...prev.workDays, d].sort();
      return { ...prev, workDays: workDays.length ? workDays : prev.workDays };
    });
  }

  return (
    <>
      <section className="os-int-section" aria-label="Event type">
        <h3>Which call J books</h3>
        {typesError && <p className="os-int-hint os-int-bad">{typesError}</p>}
        <div className="os-cal-types">
          {rows.map((r) => {
            const current = s.eventTypes[r.id] ?? "";
            const known = types?.some((t) => t.id === current);
            return (
              <label key={r.id} className="os-cal-type" htmlFor={`${id}-et-${r.id}`}>
                <span>{r.name}</span>
                <span className="os-select">
                  <select id={`${id}-et-${r.id}`} value={current} disabled={!types} onChange={(e) => pickType(r.id, e.target.value)}>
                    <option value="">{r.id === DEFAULT_SETTER_KEY ? "Pick an event type" : "Same as the default"}</option>
                    {current && !known && <option value={current}>{s.eventTypeInfo[current]?.name ?? "Saved event type"}</option>}
                    {(types ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.durationMinutes ? ` · ${t.durationMinutes} min` : ""}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            );
          })}
        </div>
        {!types && !typesError && <p className="os-int-hint">Loading your event types…</p>}
      </section>

      <section className="os-int-section" aria-label="When">
        <h3>When J offers times</h3>
        <div className="os-cal-grid">
          <label className="os-field" htmlFor={`${id}-tz`}>
            <span>Your timezone</span>
            <input
              id={`${id}-tz`}
              className="os-input"
              list={`${id}-zones`}
              spellCheck={false}
              value={s.hostTimezone}
              onChange={(e) => set("hostTimezone", e.target.value)}
            />
            <datalist id={`${id}-zones`}>
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
          </label>
          <div className="os-field">
            <span id={`${id}-hours`}>Working hours</span>
            <div className="os-cal-hours" role="group" aria-labelledby={`${id}-hours`}>
              <span className="os-select">
                <select aria-label="From" value={s.workStart} onChange={(e) => set("workStart", Number(e.target.value))}>
                  {HOURS.slice(0, 24).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </span>
              <span className="muted">to</span>
              <span className="os-select">
                <select aria-label="Until" value={s.workEnd} onChange={(e) => set("workEnd", Number(e.target.value))}>
                  {HOURS.slice(1).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </span>
            </div>
          </div>
          <div className="os-field os-cal-wide">
            <span id={`${id}-days`}>Days</span>
            <div className="os-segmented" role="group" aria-labelledby={`${id}-days`}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" aria-pressed={s.workDays.includes(d)} onClick={() => toggleDay(d)}>
                  {WEEKDAY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>
          <label className="os-field" htmlFor={`${id}-notice`}>
            <span>Earliest call (hours from now)</span>
            <input id={`${id}-notice`} className="os-input" type="number" min={0} max={168} value={s.minNoticeHours} onChange={(e) => set("minNoticeHours", Number(e.target.value))} />
          </label>
          <label className="os-field" htmlFor={`${id}-ahead`}>
            <span>Look ahead (days)</span>
            <input id={`${id}-ahead`} className="os-input" type="number" min={1} max={30} value={s.daysAhead} onChange={(e) => set("daysAhead", Number(e.target.value))} />
          </label>
          <div className="os-field">
            <span id={`${id}-opts`}>Times to offer</span>
            <div className="os-segmented" role="group" aria-labelledby={`${id}-opts`}>
              {[1, 2, 3].map((n) => (
                <button key={n} type="button" aria-pressed={s.options === n} onClick={() => set("options", n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="os-int-hint">Your calendar already hides busy times. These narrow it to when you want setter calls. Times are offered in their timezone.</p>
        <div className="os-int-inline os-cal-save">
          <button
            type="button"
            className="os-button"
            disabled={previewing}
            onClick={() => {
              setPreviewError(null);
              startPreview(async () => {
                const r = await previewTimes(view.provider);
                if (r.error) setPreviewError(r.error);
                else setPreview({ times: r.times ?? [], offered: r.offered ?? [] });
              });
            }}
          >
            {previewing ? "Reading your calendar…" : "Show the next free times"}
          </button>
          <button
            type="button"
            className="os-button primary"
            disabled={pending}
            onClick={() =>
              onAct(async () => {
                const r = await saveCalendarSettings(view.provider, s);
                setPreview(null);
                return r;
              })
            }
          >
            Save
          </button>
        </div>
        {previewError && <p className="os-int-hint os-int-bad">{previewError}</p>}
        {preview && (
          <div className="os-cal-preview" role="status">
            {preview.times.length ? (
              <>
                <p>
                  J would offer <strong>{preview.offered.join(" or ")}</strong> (your time). Saved settings only.
                </p>
                <ul>
                  {preview.times.map((t) => (
                    <li key={t} data-offered={preview.offered.includes(t) || undefined}>
                      {t}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>No free times in that window. Widen the hours or look further ahead.</p>
            )}
          </div>
        )}
      </section>
    </>
  );
}
