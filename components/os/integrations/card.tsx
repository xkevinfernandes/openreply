"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import {
  connectGhl,
  disconnectGhl,
  setSyncEnabled,
  syncExisting,
  testConnection,
  type IntegrationActionResult,
} from "@/app/(os)/os/integrations/actions";
import { shortAgo } from "@/lib/os/labels";
import type { IntegrationView } from "@/lib/os/integrations/view";
import { PROVIDER_INFO } from "@/lib/os/integrations/view-info";
import MappingEditor from "./mapping-editor";

function Logo({ provider }: { provider: IntegrationView["provider"] }) {
  return (
    <span className="os-int-logo" data-provider={provider} aria-hidden="true">
      {provider === "kit" ? (
        <svg viewBox="0 0 24 24">
          <path d="M7 5v14M17 5l-7.5 7L17 19" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24">
          <path d="M6 19V9M12 19V5M18 19v-7" />
          <path d="m4 11 2-2 2 2M10 7l2-2 2 2M16 14l2-2 2 2" />
        </svg>
      )}
    </span>
  );
}

function status(v: IntegrationView): { tone: "good" | "warn" | "bad" | "off"; label: string } {
  if (!v.connected) return { tone: "off", label: "Not connected" };
  if (v.lastError) return { tone: "bad", label: "Needs attention" };
  if (!v.enabled) return { tone: "warn", label: "Paused" };
  return { tone: "good", label: "Connected" };
}

type Message = { kind: "error" | "notice"; text: string } | null;

export default function IntegrationCard({ view, canManage, now }: { view: IntegrationView; canManage: boolean; now: number }) {
  const info = PROVIDER_INFO[view.provider];
  const router = useRouter();
  const [explainOpen, setExplainOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, startTransition] = useTransition();
  const explainId = useId();
  const panelId = useId();
  const st = status(view);

  function act(fn: () => Promise<IntegrationActionResult>) {
    setMessage(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setMessage({ kind: "error", text: r.error });
      else if (r.notice) setMessage({ kind: "notice", text: r.notice });
      router.refresh();
    });
  }

  /** Kit keeps its existing connect API (app/api/crm/kit), shared with the email gate. */
  function kitRequest(method: "POST" | "DELETE", body?: unknown) {
    act(async () => {
      const res = await fetch("/api/crm/kit", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
        .then((r) => r.json())
        .catch(() => ({ success: false, error: "Couldn't reach the server. Try again." }));
      if (!res.success) return { error: res.error ?? "Couldn't update Kit." };
      return { notice: method === "POST" ? "Kit connected." : "Kit disconnected." };
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
        {view.connected && view.synced > 0 && !open && (
          <span className="os-int-meta">
            {view.synced} synced{view.lastSyncedAt ? ` · ${shortAgo(view.lastSyncedAt, now)} ago` : ""}
            {view.failing ? ` · ${view.failing} failing` : ""}
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
            {view.provider === "kit" ? <KitConnect view={view} now={now} pending={pending} onKit={kitRequest} onAct={act} /> : <GhlConnect view={view} now={now} pending={pending} onAct={act} />}
          </section>

          {view.connected && (
            <>
              <section className="os-int-section" aria-label="Fields">
                <h3>What gets sent</h3>
                <MappingEditor provider={view.provider} initial={view.mapping} onSaved={(r) => setMessage(r.error ? { kind: "error", text: r.error } : { kind: "notice", text: r.notice ?? "Saved." })} />
              </section>

              <section className="os-int-section" aria-label="Sync">
                <h3>Sync</h3>
                <div className="os-int-row">
                  <div className="os-int-row-main">
                    <strong>Push changes</strong>
                    <span>Email captured, stage, tags or type changed. Retries on its own if {info.name} is down.</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="os-switch"
                    aria-checked={view.enabled}
                    aria-label={`Push changes to ${info.name}`}
                    disabled={pending}
                    onClick={() => act(() => setSyncEnabled(view.provider, !view.enabled))}
                  >
                    <span className="os-switch-knob" />
                  </button>
                </div>
                <div className="os-int-row">
                  <div className="os-int-row-main">
                    <strong>
                      {view.synced} {view.synced === 1 ? "contact" : "contacts"} synced
                    </strong>
                    <span>
                      {view.lastSyncedAt ? `Last push ${shortAgo(view.lastSyncedAt, now)} ago.` : "Nothing sent yet."} New changes go on
                      their own; this sends the people already here.
                    </span>
                  </div>
                  <button type="button" className="os-button" disabled={pending || !view.enabled} onClick={() => act(() => syncExisting(view.provider))}>
                    Send existing contacts
                  </button>
                </div>
                {view.errors.length > 0 && (
                  <ul className="os-int-errors" aria-label="Recent errors">
                    {view.errors.map((e) => (
                      <li key={e.contactId}>
                        <span className="who">{e.name}</span>
                        <span className="what">{e.error}</span>
                        {e.at && <time dateTime={e.at}>{shortAgo(e.at, now)}</time>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </article>
  );
}

interface ConnectProps {
  view: IntegrationView;
  now: number;
  pending: boolean;
  onAct: (fn: () => Promise<IntegrationActionResult>) => void;
}

function TestedLine({ view, now }: { view: IntegrationView; now: number }) {
  if (view.lastError) return <span className="os-int-bad">{view.lastError}</span>;
  if (view.lastTestedAt) return <span>Tested {shortAgo(view.lastTestedAt, now)} ago.</span>;
  return null;
}

function KitConnect({ view, now, pending, onAct, onKit }: ConnectProps & { onKit: (method: "POST" | "DELETE", body?: unknown) => void }) {
  const [apiKey, setApiKey] = useState("");
  const id = useId();
  if (!view.connected) {
    return (
      <form
        className="os-int-form"
        onSubmit={(e) => {
          e.preventDefault();
          onKit("POST", { apiKey });
          setApiKey("");
        }}
      >
        <label className="os-field" htmlFor={`${id}-key`}>
          <span>Kit API key</span>
          <input id={`${id}-key`} className="os-input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
        </label>
        <p className="os-int-hint">A v4 API key from Kit → Settings → Developer. Encrypted, never shown again. Campaign email gates use the same key.</p>
        <button className="os-button primary" disabled={pending || apiKey.trim().length < 10}>
          {pending ? "Checking…" : "Connect Kit"}
        </button>
      </form>
    );
  }
  return (
    <div className="os-int-row">
      <div className="os-int-row-main">
        <strong>API key saved</strong>
        <TestedLine view={view} now={now} />
      </div>
      <div className="os-int-inline">
        <button type="button" className="os-button" disabled={pending} onClick={() => onAct(() => testConnection("kit"))}>
          Test connection
        </button>
        <button
          type="button"
          className="os-button ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Disconnect Kit? Campaign email gates stop adding people to Kit too.")) onKit("DELETE");
          }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}

function GhlConnect({ view, now, pending, onAct }: ConnectProps) {
  const [token, setToken] = useState("");
  const [locationId, setLocationId] = useState(view.locationId ?? "");
  const id = useId();
  if (!view.connected) {
    return (
      <form
        className="os-int-form"
        onSubmit={(e) => {
          e.preventDefault();
          onAct(async () => {
            const r = await connectGhl({ token, locationId });
            if (!r.error) setToken("");
            return r;
          });
        }}
      >
        <div className="os-int-grid2">
          <label className="os-field" htmlFor={`${id}-token`}>
            <span>Private integration token</span>
            <input id={`${id}-token`} className="os-input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
          </label>
          <label className="os-field" htmlFor={`${id}-loc`}>
            <span>Location id</span>
            <input id={`${id}-loc`} className="os-input" autoComplete="off" spellCheck={false} value={locationId} onChange={(e) => setLocationId(e.target.value)} required />
          </label>
        </div>
        <p className="os-int-hint">
          In the sub-account: Settings → Private Integrations → Create, with the scopes contacts (view and edit), custom fields (view) and, for a
          pipeline, opportunities (view and edit). The location id is in Settings → Business Profile. The token is tested, then encrypted.
        </p>
        <button className="os-button primary" disabled={pending || token.trim().length < 10 || locationId.trim().length < 5}>
          {pending ? "Testing…" : "Test and connect"}
        </button>
      </form>
    );
  }
  return (
    <div className="os-int-row">
      <div className="os-int-row-main">
        <strong>
          Location <code>{view.locationId}</code>
        </strong>
        <TestedLine view={view} now={now} />
      </div>
      <div className="os-int-inline">
        <button type="button" className="os-button" disabled={pending} onClick={() => onAct(() => testConnection("ghl"))}>
          Test connection
        </button>
        <button
          type="button"
          className="os-button ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Disconnect GoHighLevel? Nothing more is sent until you reconnect. Your field mapping is kept.")) onAct(disconnectGhl);
          }}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
