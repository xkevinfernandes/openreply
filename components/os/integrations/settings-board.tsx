"use client";

// Settings › Integrations (Settings board): the Instagram account strip, then
// rows grouped Content (Data OS) · Calendar · CRM and email. Manage opens the
// full controls under the row.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectDataOs, removeDataOs } from "@/app/(os)/os/integrations/actions";
import { InfoTip } from "@/components/os/ui";
import type { CalendarBoard } from "@/lib/os/integrations/calendar/view";
import type { DataOsView } from "@/lib/os/integrations/dataos";
import type { IntegrationView } from "@/lib/os/integrations/view";
import { shortAgo } from "@/lib/os/labels";
import CalendarCard from "./calendar-card";
import IntegrationCard from "./card";

export interface InstagramStrip {
  username: string | null;
  provider: string | null;
  problem: string | null;
  sendCap: number;
}

interface Props {
  instagram: InstagramStrip;
  dataos: DataOsView;
  views: IntegrationView[];
  calendars: CalendarBoard;
  /** Custom fields mapped per provider (Settings › Custom fields). */
  mapped: { ghl: number; kit: number };
  kitTags: string[];
  canManage: boolean;
  now: number;
}

type Tone = "good" | "warn" | "bad" | "off";

interface RowProps {
  id: string;
  logo: React.ReactNode;
  name: string;
  sub: React.ReactNode;
  tone: Tone;
  status: string;
  action: string;
  primary?: boolean;
  canManage: boolean;
  children: React.ReactNode;
}

function Row({ id, logo, name, sub, tone, status, action, primary, canManage, children }: RowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="os-si-item" data-open={open || undefined}>
      <div className="os-si-row">
        <span className="os-si-logo" aria-hidden="true">
          {logo}
        </span>
        <span className="os-si-text">
          <span className="os-si-name">{name}</span>
          <span className="os-si-sub">{sub}</span>
        </span>
        <span className="os-si-status" data-tone={tone}>
          <i />
          {status}
        </span>
        {canManage ? (
          <button type="button" className={`os-si-btn${primary && !open ? " primary" : ""}`} aria-expanded={open} aria-controls={`si-${id}`} onClick={() => setOpen((o) => !o)}>
            {open ? "Done" : action}
          </button>
        ) : (
          <span />
        )}
      </div>
      {open ? (
        <div className="os-si-manage" id={`si-${id}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function crmTone(v: IntegrationView): { tone: Tone; status: string } {
  if (!v.connected) return v.provider === "ghl" ? { tone: "warn", status: "Needs token" } : { tone: "off", status: "Not connected" };
  if (v.lastError || v.failing) return { tone: "bad", status: "Needs attention" };
  if (!v.enabled) return { tone: "warn", status: "Paused" };
  return { tone: "good", status: "Connected" };
}

const DB_ICON = (
  <svg viewBox="0 0 16 16">
    <ellipse cx="8" cy="3.8" rx="5" ry="1.8" />
    <path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" />
  </svg>
);

export default function SettingsIntegrations({ instagram, dataos, views, calendars, mapped, kitTags, canManage, now }: Props) {
  const ghl = views.find((v) => v.provider === "ghl");
  const kit = views.find((v) => v.provider === "kit");
  const lastSync = views.map((v) => v.lastSyncedAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null;
  const setterName = (id: string) => calendars.setters.find((s) => s.id === id)?.name ?? (id === "default" ? "every setter" : null);

  return (
    <div className="os-si">
      <section className="os-si-ig" aria-labelledby="si-ig">
        <span className="os-si-logo light" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <rect x="2" y="2" width="12" height="12" rx="3.5" />
            <circle cx="8" cy="8" r="2.8" />
            <path d="M11.6 4.4h.01" />
          </svg>
        </span>
        <span className="os-si-text">
          <h2 id="si-ig" className="os-si-name">
            {instagram.username ? `@${instagram.username}` : "No Instagram account"}
          </h2>
          <span className="os-si-sub">{instagram.provider === "ZERNIO" ? "Via Zernio · Business account" : instagram.provider ? "Own Meta app" : "Connect one to start"}</span>
        </span>
        <span className="os-si-status" data-tone={instagram.username ? (instagram.problem ? "bad" : "good") : "off"}>
          <i />
          {instagram.username ? (instagram.problem ?? "Connected") : "Not connected"}
        </span>
        <span className="os-si-cap">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.3v.1" />
          </svg>
          Send cap {instagram.sendCap}/day
        </span>
        <InfoTip label="Why is there a send cap?">Instagram limits how many DMs a new or flagged account may send. Every bubble counts; change the cap in Workspace.</InfoTip>
        <Link href="/os/settings" className="os-si-link">
          Manage
        </Link>
      </section>

      <section className="os-si-group" aria-labelledby="si-content">
        <h2 id="si-content">Content</h2>
        <div className="os-si-box">
          <Row
            id="dataos"
            logo={DB_ICON}
            name="Data OS"
            sub="Stories and content"
            tone={dataos.connected ? (dataos.lastError ? "bad" : "good") : "off"}
            status={dataos.connected ? (dataos.lastError ? "Needs attention" : dataos.mode === "mock" ? "Connected · sample" : "Connected") : "Not connected"}
            action={dataos.connected ? "Manage" : "Connect"}
            primary={!dataos.connected}
            canManage={canManage}
          >
            <DataOsForm view={dataos} />
          </Row>
        </div>
      </section>

      <section className="os-si-group" aria-labelledby="si-cal">
        <h2 id="si-cal">Calendar</h2>
        <div className="os-si-box">
          {calendars.calendars.map((c) => {
            const name = c.provider === "calcom" ? "Cal.com" : "Calendly";
            const firstType = Object.entries(c.settings.eventTypes)[0];
            const info = firstType ? c.settings.eventTypeInfo[firstType[1]] : null;
            const who = firstType ? setterName(firstType[0]) : null;
            const sub = c.connected
              ? info
                ? `Event type: ${info.name}${info.durationMinutes ? ` · ${info.durationMinutes} min` : ""}${who ? ` · used by ${who}` : ""}`
                : `${c.upcoming} upcoming · ${c.booked} booked`
              : c.provider === "calcom"
                ? "J offers live times"
                : "Booking link or live times";
            return (
              <Row
                key={c.provider}
                id={c.provider}
                logo={<span className="os-si-mono">{c.provider === "calcom" ? "Cal" : "Cy"}</span>}
                name={name}
                sub={sub}
                tone={c.connected ? (c.lastError ? "bad" : c.enabled ? "good" : "warn") : "off"}
                status={c.connected ? (c.lastError ? "Needs attention" : c.enabled ? "Connected" : "Paused") : "Not connected"}
                action={c.connected ? "Manage" : "Connect"}
                canManage={canManage}
              >
                <CalendarCard view={c} setters={calendars.setters} canManage={canManage} now={now} embedded />
              </Row>
            );
          })}
        </div>
        {calendars.sample ? <p className="os-si-note">Sample calendar (OS_MOCK).</p> : null}
      </section>

      <section className="os-si-group" aria-labelledby="si-crm">
        <h2 id="si-crm">CRM and email</h2>
        <div className="os-si-box">
          {ghl ? (
            <Row
              id="ghl"
              logo={<span className="os-si-mono">GHL</span>}
              name="GoHighLevel"
              sub={`Syncs ${mapped.ghl} custom field${mapped.ghl === 1 ? "" : "s"}${ghl.connected ? "" : " · paused until token is added"}`}
              {...crmTone(ghl)}
              action={ghl.connected ? "Manage" : "Add token"}
              primary={!ghl.connected}
              canManage={canManage}
            >
              <IntegrationCard view={ghl} canManage={canManage} now={now} embedded />
            </Row>
          ) : null}
          {kit ? (
            <Row
              id="kit"
              logo={<span className="os-si-mono">Kit</span>}
              name="Kit"
              sub={
                kitTags.length ? (
                  <span className="os-si-tags">
                    Tags:
                    {kitTags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </span>
                ) : (
                  `Syncs ${mapped.kit} custom field${mapped.kit === 1 ? "" : "s"}`
                )
              }
              {...crmTone(kit)}
              action={kit.connected ? "Manage" : "Connect"}
              canManage={canManage}
            >
              <IntegrationCard view={kit} canManage={canManage} now={now} embedded />
            </Row>
          ) : null}
        </div>
      </section>

      <p className="os-si-foot">
        Last sync {lastSync ? `${shortAgo(lastSync, now)} ago` : "never"} ·{" "}
        <Link href="/os/settings?tab=logs">View DM logs</Link>
      </p>
    </div>
  );
}

function DataOsForm({ view }: { view: DataOsView }) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(view.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ error?: string; notice?: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="os-si-form"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await connectDataOs({ baseUrl, token });
          setMsg(r);
          if (!r.error) {
            setToken("");
            router.refresh();
          }
        });
      }}
    >
      <label>
        <span>Address</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://dataos.example.com" required />
      </label>
      <label>
        <span>Token</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={view.baseUrl ? "Leave empty to keep" : "Paste the API token"} autoComplete="off" />
      </label>
      <div className="os-si-form-actions">
        {view.baseUrl ? (
          <button
            type="button"
            className="os-si-btn"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await removeDataOs();
                setMsg(r);
                if (!r.error) router.refresh();
              })
            }
          >
            Disconnect
          </button>
        ) : null}
        <span className="os-si-grow" />
        {msg?.error ? <span className="os-si-err">{msg.error}</span> : msg?.notice ? <span className="os-si-ok">{msg.notice}</span> : null}
        <button type="submit" className="os-si-btn primary" disabled={pending}>
          Save
        </button>
      </div>
    </form>
  );
}
