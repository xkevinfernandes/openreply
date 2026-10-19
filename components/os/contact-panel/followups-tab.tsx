"use client";

// Follow-ups tab (contact panel). Owner: S5. What's queued for this person,
// the broadcasts they're in, and two switches: follow-ups on, Friday list.

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { loadPanelFollowups, sendFollowupNow, setFollowupsOn, setOnFriday, skipFollowup } from "@/app/(os)/os/follow-ups/actions";
import { EmptyState } from "@/components/os/ui";
import type { ContactFollowupsData } from "@/lib/os/contact-panel/followups";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <label className="os-pf-switch">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="os-switch" disabled={disabled} onClick={onToggle}>
        <span className="os-switch-knob" />
      </button>
    </label>
  );
}

export default function FollowupsTab({ data }: { data: ContactPanelData }) {
  const [state, setState] = useState<ContactFollowupsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    const r = await loadPanelFollowups(data.contactId);
    if ("error" in r) setError(r.error);
    else {
      setError(null);
      setState(r);
    }
  }, [data.contactId]);

  useEffect(() => {
    let live = true;
    loadPanelFollowups(data.contactId).then((r) => {
      if (!live) return;
      if ("error" in r) setError(r.error);
      else setState(r);
    });
    return () => {
      live = false;
    };
  }, [data.contactId]);

  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      await load();
    });

  if (error && !state) return <EmptyState title={error} />;
  if (!state) return <div className="os-pf-loading" aria-busy="true" />;

  return (
    <div className="os-pf">
      <div className="os-pf-switches">
        <Switch on={!state.off} label="Follow-ups" disabled={pending} onToggle={() => act(() => setFollowupsOn(data.contactId, state.off))} />
        <Switch on={state.onFriday} label="Follow-up Friday" disabled={pending} onToggle={() => act(() => setOnFriday(data.contactId, !state.onFriday))} />
      </div>
      {error ? (
        <p className="os-pf-err" role="status">
          {error}
        </p>
      ) : null}

      {state.steps.length ? (
        <ul className="os-pf-list" aria-label="Queued">
          {state.steps.map((s) => (
            <li key={s.id}>
              <div className="os-pf-line">
                <span className="os-pf-when">{s.when}</span>
                <Link className="os-pf-src" href={s.href}>
                  {s.source}
                </Link>
              </div>
              <p className="os-pf-preview" data-goal={s.writesAtSendTime || undefined}>
                {s.ready ? <span className="os-tl-dot" aria-label="Draft ready" /> : null}
                {s.writesAtSendTime ? <em>J writes this at send time · </em> : null}
                {s.preview}
              </p>
              {s.stepId ? (
                <div className="os-pf-acts">
                  <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => sendFollowupNow(s.stepId!))}>
                    Send now
                  </button>
                  <button type="button" className="os-bc-quiet" disabled={pending} onClick={() => act(() => skipFollowup(s.stepId!))}>
                    Skip
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="os-pf-none">{state.off ? "Follow-ups are off for them." : (state.why ?? "Nothing queued.")}</p>
      )}

      {state.broadcasts.length ? (
        <section aria-label="Broadcasts" className="os-pf-bc">
          <h3>Broadcasts</h3>
          <ul className="os-pf-list">
            {state.broadcasts.map((b) => (
              <li key={b.id}>
                <div className="os-pf-line">
                  <span className="os-pf-when">{b.when ?? b.status}</span>
                  <Link className="os-pf-src" href={b.href}>
                    {b.name} · {b.status}
                  </Link>
                </div>
                {b.preview ? <p className="os-pf-preview">{b.preview}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
