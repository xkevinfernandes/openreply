"use client";

// Settings › Integrations (Integrations canvas): Instagram, Zernio, Kit and
// Cal.com first, each with its logo, status, one line and its actions; Data
// OS, GoHighLevel and Calendly below. Manage opens the full controls under
// the row.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectDataOs, removeDataOs } from "@/app/(os)/os/integrations/actions";
import { DisconnectButton, InstagramFixButton, ZernioPanel } from "@/components/os/settings/instagram-panel";
import type { InstagramProblem } from "@/lib/os/connections-view";
import type { CalendarBoard } from "@/lib/os/integrations/calendar/view";
import type { DataOsView } from "@/lib/os/integrations/dataos";
import type { IntegrationView } from "@/lib/os/integrations/view";
import { shortAgo } from "@/lib/os/labels";
import CalendarCard from "./calendar-card";
import IntegrationCard from "./card";
import { CalcomWordmark, InstagramLogo, KitLogo, ZernioLogo } from "./logos";
import type { MappingFieldSource } from "./mapping-editor";

export interface InstagramStrip {
  /** The InstagramAccount id (Disconnect); null in sample mode. */
  id: string | null;
  username: string | null;
  provider: string | null;
  /** The first problem and its fix (lib/os/connections.ts), the same as every screen. */
  problem: InstagramProblem | null;
  /** OS_MOCK sample account. */
  sample: boolean;
}

interface Props {
  instagram: InstagramStrip;
  zernio: { configured: boolean; webhookReady: boolean };
  dataos: DataOsView;
  views: IntegrationView[];
  calendars: CalendarBoard;
  /** Custom fields mapped per provider (Settings › Custom fields). */
  mapped: { ghl: number; kit: number };
  /** The global custom fields, for each CRM's Custom fields mapping. */
  fields?: MappingFieldSource[];
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
  /** Links/buttons shown instead of the Manage toggle. */
  actions?: React.ReactNode;
  /** The logo tile: "brand" = white in both themes (Zernio). */
  tile?: "brand";
  children?: React.ReactNode;
}

function Row({ id, logo, name, sub, tone, status, action, primary, canManage, actions, tile, children }: RowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="os-si-item" data-open={open || undefined} data-id={id}>
      <div className="os-si-row">
        <span className="os-si-logo" data-tile={tile} aria-hidden="true">
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
        {actions ? (
          <span className="os-si-acts">{actions}</span>
        ) : canManage ? (
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

export default function SettingsIntegrations({ instagram, zernio, dataos, views, calendars, mapped, fields = [], kitTags, canManage, now }: Props) {
  const ghl = views.find((v) => v.provider === "ghl");
  const kit = views.find((v) => v.provider === "kit");
  const calcom = calendars.calendars.find((c) => c.provider === "calcom");
  const others = calendars.calendars.filter((c) => c.provider !== "calcom");
  const lastSync = views.map((v) => v.lastSyncedAt).filter((v): v is string => Boolean(v)).sort().pop() ?? null;
  const setterName = (id: string) => calendars.setters.find((s) => s.id === id)?.name ?? (id === "default" ? "every setter" : null);

  const calendarRow = (c: CalendarBoard["calendars"][number]) => {
    const name = c.provider === "calcom" ? "Cal.com" : "Calendly";
    const firstType = Object.entries(c.settings.eventTypes)[0];
    const info = firstType ? c.settings.eventTypeInfo[firstType[1]] : null;
    const who = firstType ? setterName(firstType[0]) : null;
    const sub = c.connected
      ? info
        ? `Event type: ${info.name}${info.durationMinutes ? ` · ${info.durationMinutes} min` : ""}${who ? ` · used by ${who}` : ""}`
        : c.provider === "calcom"
          ? `Calls J books land here, and bookings, reschedules and no-shows come back. ${c.upcoming} upcoming.`
          : `${c.upcoming} upcoming · ${c.booked} booked`
      : c.provider === "calcom"
        ? "J offers live times and books the call"
        : "Booking link or live times";
    return (
      <Row
        key={c.provider}
        id={c.provider}
        logo={c.provider === "calcom" ? <CalcomWordmark /> : <span className="os-si-mono">Cy</span>}
        name={name}
        sub={sub}
        tone={c.connected ? (c.lastError ? "bad" : c.enabled ? "good" : "warn") : "off"}
        status={c.connected ? (c.lastError ? "Needs attention" : c.enabled ? "Connected" : "Paused") : "Not connected"}
        action={c.connected ? "Event types" : "Connect"}
        canManage={canManage}
      >
        <CalendarCard view={c} setters={calendars.setters} canManage={canManage} now={now} embedded />
      </Row>
    );
  };

  return (
    <div className="os-si">
      <header className="os-si-head">
        <h2>Integrations</h2>
        <p>What the DM OS talks to.</p>
      </header>

      <section className="os-si-group" aria-label="Main integrations">
        <div className="os-si-box">
          <Row
            id="instagram"
            logo={<InstagramLogo />}
            name="Instagram"
            sub={
              instagram.username
                ? `@${instagram.username}. Comments, DMs and story replies come in through this account.`
                : "Connect an account to start."
            }
            tone={instagram.username ? (instagram.problem ? "bad" : "good") : "off"}
            status={instagram.username ? (instagram.problem?.text ?? "Connected") : "Not connected"}
            action="Manage"
            canManage={canManage}
            actions={
              <>
                {instagram.problem && canManage ? (
                  <InstagramFixButton fix={instagram.problem.fix} sample={instagram.sample} className="os-si-btn primary" />
                ) : (
                  <Link href="/os/settings?tab=instagram" className={`os-si-btn${!instagram.username ? " primary" : ""}`}>
                    {instagram.username ? "Manage" : "Connect"}
                  </Link>
                )}
                {canManage && instagram.id && instagram.username ? <DisconnectButton id={instagram.id} username={instagram.username} /> : null}
              </>
            }
          />
          <Row
            id="zernio"
            logo={<ZernioLogo />}
            tile="brand"
            name="Zernio"
            sub="Sends and reads DMs without your own Meta app. Inbox access, key stored encrypted."
            tone={zernio.configured ? (zernio.webhookReady ? "good" : "bad") : "off"}
            status={zernio.configured ? (zernio.webhookReady ? "Connected" : "Webhook not set up") : "Not connected"}
            action={zernio.configured ? "Manage" : "Connect"}
            primary={!zernio.configured}
            canManage={canManage}
          >
            <ZernioPanel canManage={canManage} embedded sample={instagram.sample && instagram.username ? { username: instagram.username } : null} />
          </Row>
          {kit ? (
            <Row
              id="kit"
              logo={<KitLogo />}
              name="Kit"
              sub={
                kit.connected ? (
                  kitTags.length ? (
                    <span className="os-si-tags">
                      Captured emails and tags sync to your Kit list. Tags:
                      {kitTags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </span>
                  ) : kit.lastSyncedAt ? (
                    `Captured emails and tags sync to your Kit list. Last sync ${shortAgo(kit.lastSyncedAt, now)} ago, ${kit.failing ? `${kit.failing} failing` : "no errors"}.`
                  ) : (
                    "Connected · nothing synced yet"
                  )
                ) : (
                  "Captured emails and tags sync to your Kit list."
                )
              }
              {...crmTone(kit)}
              action={kit.connected ? "Manage" : "Connect"}
              primary={!kit.connected}
              canManage={canManage}
            >
              <IntegrationCard view={kit} fields={fields} canManage={canManage} now={now} embedded />
            </Row>
          ) : null}
          {calcom ? calendarRow(calcom) : null}
        </div>
      </section>

      <section className="os-si-group" aria-labelledby="si-more">
        <h2 id="si-more">More</h2>
        <div className="os-si-box">
          <Row
            id="dataos"
            logo={DB_ICON}
            name="Data OS"
            sub="Stories and content"
            tone={dataos.connected ? (dataos.lastError ? "bad" : "good") : "off"}
            status={dataos.connected ? (dataos.lastError ? "Needs attention" : dataos.mode === "mock" ? "Connected · sample" : "Connected") : "Not connected"}
            action={dataos.connected ? "Manage" : "Connect"}
            canManage={canManage}
          >
            <DataOsForm view={dataos} />
          </Row>
          {ghl ? (
            <Row
              id="ghl"
              logo={<span className="os-si-mono">GHL</span>}
              name="GoHighLevel"
              sub={`Syncs ${mapped.ghl} custom field${mapped.ghl === 1 ? "" : "s"}${ghl.connected ? "" : " · paused until token is added"}`}
              {...crmTone(ghl)}
              action={ghl.connected ? "Manage" : "Add token"}
              canManage={canManage}
            >
              <IntegrationCard view={ghl} fields={fields} canManage={canManage} now={now} embedded />
            </Row>
          ) : null}
          {others.map(calendarRow)}
        </div>
      </section>

      <p className="os-si-foot">
        Last sync {lastSync ? `${shortAgo(lastSync, now)} ago` : "never"} · <Link href="/os/settings?tab=logs">View DM logs</Link>
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
