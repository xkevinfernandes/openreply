"use client";

// Setup › Booking, Fields J fills and Follow-ups, one page (SetterBooking board).

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveBooking, setSetterField } from "@/app/(os)/os/knowledge/actions";
import FollowupsEditor from "@/components/os/knowledge/followups-editor";
import { useSaver } from "@/components/os/knowledge/fields";
import { InfoTip, SetterMark } from "@/components/os/ui";
import type { BookingMode } from "@/lib/os/integrations/calendar/setter-booking";
import type { BookingView, FieldPick, SetterEditorView } from "@/lib/os/knowledge";

const TYPE_LABEL: Record<string, string> = {
  TEXT: "Text",
  LONG_TEXT: "Long text",
  NUMBER: "Number",
  EMAIL: "Email",
  DATE: "Date",
  TIMEZONE: "Timezone",
  SELECT: "Select",
  URL: "URL",
};

export default function BookingSetup({ view }: { view: SetterEditorView }) {
  return (
    <>
      <BookingSection setterId={view.id} name={view.name} initial={view.booking} />
      <FieldsSection setterId={view.id} name={view.name} fields={view.fields} />
      <FollowupsEditor setterId={view.id} sequences={view.sequences} />
    </>
  );
}

function BookingSection({ setterId, name, initial }: { setterId: string; name: string; initial: BookingView }) {
  const [b, setB] = useState({
    mode: initial.mode as BookingMode,
    propose: initial.propose,
    withinDays: initial.withinDays,
    fallbackAfterHours: initial.fallbackAfterHours,
    link: initial.link ?? initial.inheritedLink ?? "",
  });
  const [saved, setSaved] = useState(() => JSON.stringify(b));
  const saver = useSaver();
  const dirty = JSON.stringify(b) !== saved;
  const cal = initial.calendar;
  const set = (p: Partial<typeof b>) => setB({ ...b, ...p });
  const save = () => {
    const snap = JSON.stringify(b);
    saver.run(async () => {
      const r = await saveBooking(setterId, b);
      if (!r.error) setSaved(snap);
      return r;
    });
  };
  const link = b.link.replace(/^https?:\/\//, "") || "your booking link";
  return (
    <section id="booking" aria-labelledby="kb-booking" className="kb-sec">
      <div className="kb-sec-h">
        <h2 id="kb-booking">Booking</h2>
        <span className="kb-status">
          <span className="kb-live" data-off={cal ? undefined : "true"} aria-hidden="true" />
          {cal ? `${cal.provider} connected` : "No calendar"}
        </span>
        <div className="kb-grow" />
        <span className="kb-note" role="status" data-kind={saver.note?.kind}>
          {saver.pending ? "Saving…" : dirty ? "Unsaved" : saver.note?.text}
        </span>
        <button type="button" className="kb-btn kb-btn-p" onClick={save} disabled={!dirty || saver.pending}>
          Save
        </button>
      </div>
      <fieldset className="kb-modes">
        <legend className="sr-only">How {name} books calls</legend>
        <label className="kb-opt">
          <input type="radio" name="kb-mode" checked={b.mode === "calendar"} onChange={() => set({ mode: "calendar" })} />
          <span>
            <span>Offer times from my calendar{cal ? ` (${cal.provider})` : ""}</span>
            <span className="kb-quiet">
              {b.propose} times in the next {b.withinDays} days, then the link if none fit
            </span>
          </span>
        </label>
        <label className="kb-opt">
          <input type="radio" name="kb-mode" checked={b.mode === "link"} onChange={() => set({ mode: "link" })} />
          <span>
            <span>Send a booking link</span>
            <span className="kb-quiet">They pick a time themselves</span>
          </span>
        </label>
      </fieldset>
      <div className="kb-booking-body">
        <div className="kb-rows">
          {b.mode === "calendar" && (
            <>
              <div className="kb-row">
                <span className="kb-lbl">Event type</span>
                {cal ? (
                  <span>
                    {cal.eventName ?? "None picked"}
                    {cal.durationMinutes ? ` · ${cal.durationMinutes} min` : ""}{" "}
                    <Link href="/os/settings?tab=integrations" className="kb-quiet">
                      Change
                    </Link>
                  </span>
                ) : (
                  <Link href="/os/settings?tab=integrations">Connect Cal.com or Calendly</Link>
                )}
              </div>
              <div className="kb-row">
                <label className="kb-lbl" htmlFor="kb-propose">
                  Propose
                </label>
                <span className="kb-inline">
                  <select id="kb-propose" className="kb-sel" value={b.propose} onChange={(e) => set({ propose: Number(e.target.value) })}>
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "time" : "times"}
                      </option>
                    ))}
                  </select>
                  within
                  <select aria-label="Days ahead" className="kb-sel" value={b.withinDays} onChange={(e) => set({ withinDays: Number(e.target.value) })}>
                    {[1, 2, 3, 5, 7, 14].map((n) => (
                      <option key={n} value={n}>
                        {n} {n === 1 ? "day" : "days"}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              {cal && (
                <>
                  <div className="kb-row">
                    <span className="kb-lbl">Working hours</span>
                    <span>
                      {cal.hours} <span className="kb-quiet">{cal.timezone}</span>
                    </span>
                  </div>
                  <div className="kb-row">
                    <span className="kb-lbl">Minimum notice</span>
                    <span>{cal.minNoticeHours} hours</span>
                  </div>
                </>
              )}
            </>
          )}
          <div className={b.mode === "calendar" ? "kb-fallback" : undefined}>
            {b.mode === "calendar" && <span className="kb-fallback-h">Fallback to booking link</span>}
            {b.mode === "calendar" && (
              <div className="kb-row">
                <span className="kb-lbl">When</span>
                <span className="kb-inline">
                  No slot fits, or no pick within
                  <select aria-label="Hours before the link" className="kb-sel" value={b.fallbackAfterHours} onChange={(e) => set({ fallbackAfterHours: Number(e.target.value) })}>
                    {[12, 24, 48, 72].map((n) => (
                      <option key={n} value={n}>
                        {n} hours
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            )}
            <div className="kb-row">
              <label className="kb-lbl" htmlFor="kb-link">
                Booking link
              </label>
              <input id="kb-link" type="url" className="kb-input" placeholder="https://cal.com/you/intro" value={b.link} onChange={(e) => set({ link: e.target.value })} />
            </div>
          </div>
        </div>
        <figure className="kb-preview" aria-label="Preview">
          <figcaption>Preview</figcaption>
          <div className="kb-bub in">yeah down to chat</div>
          {b.mode === "calendar" ? (
            <>
              <div className="kb-bub out">nice. would tue 2pm or wed 11am work?</div>
              <span className="kb-by">
                <SetterMark name={name} /> {name} · {cal ? `${cal.provider} times` : "calendar times"}
              </span>
              <div className="kb-bub in">ah both clash for me</div>
              <div className="kb-bub out">no stress, grab whatever works here: {link}</div>
              <span className="kb-by">
                <SetterMark name={name} /> {name} · Fallback
              </span>
            </>
          ) : (
            <>
              <div className="kb-bub out">nice, grab whatever time works here: {link}</div>
              <span className="kb-by">
                <SetterMark name={name} /> {name} · Booking link
              </span>
            </>
          )}
        </figure>
      </div>
    </section>
  );
}

function FieldsSection({ setterId, name, fields }: { setterId: string; name: string; fields: FieldPick[] }) {
  const [on, setOn] = useState(() => new Set(fields.filter((f) => f.on).map((f) => f.id)));
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const toggle = (id: string, next: boolean) => {
    setError(null);
    const prev = new Set(on);
    const upd = new Set(on);
    if (next) upd.add(id);
    else upd.delete(id);
    setOn(upd);
    start(async () => {
      const r = await setSetterField(setterId, id, next);
      if (r.error) {
        setOn(prev);
        setError(r.error);
      }
    });
  };
  return (
    <section id="fields" aria-labelledby="kb-fields" className="kb-sec">
      <div className="kb-sec-h">
        <h2 id="kb-fields">Fields {name} fills</h2>
        <span className="kb-quiet">
          {on.size} of {fields.length}
        </span>
        <InfoTip label="About fields">
          {name} saves what people tell it into these fields and syncs them to your CRM. The fields themselves are global.
        </InfoTip>
        <div className="kb-grow" />
        <Link href="/os/settings?tab=fields" className="kb-quiet">
          Manage fields in Settings
        </Link>
      </div>
      {error && <p className="kb-err">{error}</p>}
      {!fields.length && <p className="kb-quiet">No custom fields yet.</p>}
      <fieldset className="kb-flds">
        <legend className="sr-only">Global fields {name} fills</legend>
        {fields.map((f) => {
          const sync = [f.ghl && "GoHighLevel", f.kit && "Kit"].filter(Boolean).join(" · ");
          return (
            <label key={f.id} className="kb-fld">
              <input type="checkbox" checked={on.has(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
              <span className="kb-fld-name">{f.label}</span>
              <span className="kb-tag">{TYPE_LABEL[f.type] ?? f.type}</span>
              {f.builtIn && <span className="kb-tag">Built-in</span>}
              <span className="kb-fld-sub">{!on.has(f.id) && f.usedBy.length ? `Used by ${f.usedBy.join(", ")}` : sync}</span>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
