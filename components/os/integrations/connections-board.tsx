"use client";

// Settings › Connections: the brand Connections pattern (@claudepreneur/brand
// ConnectionsGrid, ConnectDialog, ConnectionDetail). Every service the DM OS
// talks to: what's connected first (broken ones on top), then the rest by
// category. Each service's own settings (Kit mapping, calendar booking,
// Zernio profile, Data OS address) sit inside Manage. Keys go to the server
// once, through the same routes and actions as before, and are never held in
// state; the page only ever sees a key's last four.

import {
  Button,
  ConnectDialog,
  ConnectionDetail,
  ConnectionLogo,
  ConnectionsGrid,
  Dialog,
  TickList,
  useToast,
  type Connection,
} from "@claudepreneur/brand/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { connectDataOs, connectGhl, disconnectGhl, removeDataOs } from "@/app/(os)/os/integrations/actions";
import { connectCalendar, disconnectCalendar } from "@/app/(os)/os/integrations/calendar-actions";
import { checkConnection, checkStale } from "@/app/(os)/os/settings/connections-actions";
import { InstagramFixButton, ZernioPanel } from "@/components/os/settings/instagram-panel";
import type { BoardConnection } from "@/lib/os/conn/view";
import { APP_NAME, serviceInfo } from "@/lib/os/conn/catalog";
import type { InstagramProblem } from "@/lib/os/connections-view";
import type { CalendarBoard } from "@/lib/os/integrations/calendar/view";
import { kitKeyRequest } from "@/lib/os/integrations/kit-connect";
import type { IntegrationView } from "@/lib/os/integrations/view";
import CalendarCard from "./calendar-card";
import IntegrationCard from "./card";
import type { MappingFieldSource } from "./mapping-editor";

export interface InstagramStrip {
  /** The InstagramAccount id (Disconnect); null in sample mode. */
  id: string | null;
  username: string | null;
  problem: InstagramProblem | null;
  /** OS_MOCK sample account. */
  sample: boolean;
}

interface Props {
  connections: BoardConnection[];
  instagram: InstagramStrip;
  /** The own-Meta-app sign-in is configured (INSTAGRAM_APP_ID and friends). */
  metaOAuth: boolean;
  views: IntegrationView[];
  calendars: CalendarBoard;
  fields?: MappingFieldSource[];
  kitTags: string[];
  canManage: boolean;
  now: number;
}

type Result = { ok: true; note?: string } | { ok: false; error: string };

const fromAction = (r: { error?: string; notice?: string }): Result => (r.error ? { ok: false, error: r.error } : { ok: true, note: r.notice });

async function jsonCall(url: string, method: "POST" | "DELETE", body?: unknown): Promise<Result> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const p = (await res.json().catch(() => null)) as { success?: boolean; error?: string; warning?: string } | null;
    if (!res.ok || !p?.success) return { ok: false, error: p?.error ?? "Try again." };
    return { ok: true, note: p.warning };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again." };
  }
}

/** Services connected with more than one field. */
const FIELDS_IDS = new Set(["ghl", "dataos"]);

export default function ConnectionsBoard({ connections, instagram, metaOAuth, views, calendars, fields = [], kitTags, canManage, now }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [connectingId, setConnecting] = useState<string | null>(null);
  const [managingId, setManaging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [checking, startCheck] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const list = connections as Connection[];
  const byId = (id: string | null) => list.find((c) => c.id === id) ?? null;
  const connecting = byId(connectingId);
  const managing = byId(managingId);

  // Health is real: on open, re-check what hasn't been checked lately.
  const staleRan = useRef(false);
  useEffect(() => {
    if (staleRan.current || !canManage) return;
    staleRan.current = true;
    checkStale()
      .then((r) => {
        if (r.checked) router.refresh();
      })
      .catch(() => {});
  }, [canManage, router]);

  function openConnect(c: Connection) {
    setError(null);
    setManaging(null);
    if (c.id === "instagram" && !metaOAuth) {
      // Instagram through Zernio: the Instagram tab picks the account.
      router.push("/os/settings?tab=instagram");
      return;
    }
    setConnecting(c.id);
  }

  function onCardConnect(c: Connection) {
    if (c.status !== "available") {
      setError(null);
      setManaging(c.id);
      return;
    }
    openConnect(c);
  }

  function finish(res: Result, c: Connection, after?: () => void) {
    if (res.ok) {
      setConnecting(null);
      toast({ title: `${c.name} connected`, description: res.note, tone: "good" });
      after?.();
    } else {
      setError(res.error);
    }
    router.refresh();
  }

  function submitKey(c: Connection, key: string) {
    setError(null);
    start(async () => {
      if (c.id === "kit") {
        const r = await kitKeyRequest(fetch, "POST", { apiKey: key, replacing: c.status !== "available" });
        return finish(r.ok ? { ok: true, note: r.notice } : { ok: false, error: r.error }, c);
      }
      if (c.id === "zernio") {
        // Then pick the profile in Manage (Zernio's own step).
        return finish(await jsonCall("/api/zernio/settings", "POST", { apiKey: key }), c, () => setManaging("zernio"));
      }
      if (c.id === "calcom" || c.id === "calendly") return finish(fromAction(await connectCalendar(c.id, key)), c);
    });
  }

  function submitFields(c: Connection, v: Record<string, string>) {
    setError(null);
    start(async () => {
      if (c.id === "ghl") return finish(fromAction(await connectGhl({ token: v.token ?? "", locationId: v.locationId ?? "" })), c);
      if (c.id === "dataos") return finish(fromAction(await connectDataOs({ baseUrl: v.baseUrl ?? "", token: v.token ?? "" })), c);
    });
  }

  function check(c: Connection) {
    startCheck(async () => {
      const r = await checkConnection(c.id);
      toast(
        r.ok
          ? { title: `${c.name} answered`, description: r.account, tone: "good" }
          : { title: `${c.name} check failed`, description: r.error, tone: "bad" }
      );
      router.refresh();
    });
  }

  function disconnect(c: Connection) {
    if (!canManage) {
      toast({ title: "Only workspace owners and admins can disconnect.", tone: "bad" });
      return;
    }
    startDisconnect(async () => {
      let r: Result;
      switch (c.id) {
        case "instagram":
          r = await jsonCall("/api/instagram/disconnect", "POST", instagram.id ? { instagramAccountId: instagram.id } : {});
          break;
        case "zernio":
          r = await jsonCall("/api/zernio/settings", "DELETE");
          break;
        case "kit": {
          const k = await kitKeyRequest(fetch, "DELETE");
          r = k.ok ? { ok: true } : { ok: false, error: k.error };
          break;
        }
        case "ghl":
          r = fromAction(await disconnectGhl());
          break;
        case "calcom":
        case "calendly":
          r = fromAction(await disconnectCalendar(c.id));
          break;
        case "dataos":
          r = fromAction(await removeDataOs());
          break;
        default:
          r = { ok: false, error: "This one is set up on the server." };
      }
      if (r.ok) {
        setManaging(null);
        const help = c.keyHelpHref;
        toast({
          title: `${c.name} disconnected`,
          description:
            r.note ??
            (c.method === "key"
              ? "The stored key is deleted. The key itself keeps working until you delete it at the provider."
              : "The stored token is deleted."),
          tone: "neutral",
          duration: 10_000,
          ...(help ? { action: { label: "Open settings", onClick: () => window.open(help, "_blank", "noopener") } } : {}),
        });
      } else {
        toast({ title: `Couldn't disconnect ${c.name}`, description: r.error, tone: "bad" });
      }
      router.refresh();
    });
  }

  const keyDialog = connecting && !FIELDS_IDS.has(connecting.id) ? connecting : null;
  const fieldsDialog = connecting && FIELDS_IDS.has(connecting.id) ? connecting : null;
  const lastSync = views
    .map((v) => v.lastSyncedAt)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  return (
    <div className="os-conn">
      <header className="os-si-head">
        <h2>Connections</h2>
        <p>Everything the DM OS talks to. Keys stay encrypted on the server; this page only ever shows their last four.</p>
      </header>

      <ConnectionsGrid connections={list} onConnect={canManage ? onCardConnect : undefined} onManage={(c) => setManaging(c.id)} />

      <p className="os-si-foot">
        Last sync {lastSync ? new Date(lastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never"} ·{" "}
        <Link href="/os/settings?tab=logs">View DM logs</Link>
      </p>

      <ConnectDialog
        open={Boolean(keyDialog)}
        connection={keyDialog}
        appName={APP_NAME}
        scopes={keyDialog?.scopes ?? []}
        never={keyDialog?.never}
        onClose={() => setConnecting(null)}
        onContinue={(c) => {
          if (c.id === "instagram") window.location.href = "/api/instagram/connect";
        }}
        onSubmitKey={submitKey}
        busy={busy}
        error={error}
      />

      <FieldsConnectDialog open={Boolean(fieldsDialog)} connection={fieldsDialog} onClose={() => setConnecting(null)} onSubmit={submitFields} busy={busy} error={error} />

      <ConnectionDetail
        open={Boolean(managing)}
        connection={managing}
        onClose={() => setManaging(null)}
        onSyncNow={canManage ? check : undefined}
        checking={checking}
        onReplaceKey={canManage && managing?.id !== "zernio" ? (c) => {
          setManaging(null);
          setError(null);
          setConnecting(c.id);
        } : undefined}
        onDisconnect={disconnect}
        disconnecting={disconnecting}
        consequence={managing ? serviceInfo(managing.id)?.consequence : undefined}
      >
        {managing ? (
          <DetailExtras
            c={managing}
            instagram={instagram}
            views={views}
            calendars={calendars}
            fields={fields}
            kitTags={kitTags}
            canManage={canManage}
            now={now}
            onReconnect={() => {
              setManaging(null);
              setConnecting(managing.id);
            }}
          />
        ) : null}
      </ConnectionDetail>
    </div>
  );
}

/** Each service's own settings inside Manage: the same controls as before. */
function DetailExtras({
  c,
  instagram,
  views,
  calendars,
  fields,
  kitTags,
  canManage,
  now,
  onReconnect,
}: {
  c: Connection;
  instagram: InstagramStrip;
  views: IntegrationView[];
  calendars: CalendarBoard;
  fields: MappingFieldSource[];
  kitTags: string[];
  canManage: boolean;
  now: number;
  onReconnect: () => void;
}) {
  switch (c.id) {
    case "instagram":
      return (
        <div className="os-conn-extra">
          {instagram.problem && canManage ? (
            <p className="cp-field-hint">
              {instagram.problem.text}.{" "}
              <InstagramFixButton fix={instagram.problem.fix} sample={instagram.sample} className="cp-btn cp-btn-sm cp-btn-primary" />
            </p>
          ) : null}
          <p className="cp-field-hint">
            Accounts, Zernio&rsquo;s account picker and the connect notice are on the <Link href="/os/settings?tab=instagram">Instagram tab</Link>.
          </p>
        </div>
      );
    case "zernio":
      return <ZernioPanel canManage={canManage} embedded sample={instagram.sample && instagram.username ? { username: instagram.username } : null} />;
    case "kit":
    case "ghl": {
      const v = views.find((x) => x.provider === c.id);
      if (!v) return null;
      return (
        <div className="os-conn-extra">
          {c.id === "kit" && kitTags.length ? <p className="cp-field-hint">Most used tags: {kitTags.join(", ")}</p> : null}
          {v.connected ? <IntegrationCard view={v} fields={fields} canManage={canManage} now={now} embedded hideConnection /> : null}
        </div>
      );
    }
    case "calcom":
    case "calendly": {
      const v = calendars.calendars.find((x) => x.provider === c.id);
      if (!v?.connected) return null;
      return <CalendarCard view={v} setters={calendars.setters} canManage={canManage} now={now} embedded hideConnection />;
    }
    case "dataos":
      return canManage ? (
        <p className="cp-field-hint">
          To change the address or token, <Button size="sm" variant="text" className="is-ink" onClick={onReconnect}>enter them again</Button>. A blank token keeps the saved one.
        </p>
      ) : null;
    default:
      return c.method === "managed" ? (
        <p className="cp-field-hint">This key is set on the server (Railway, from Doppler). Change or rotate it there; nothing here can read it.</p>
      ) : null;
  }
}

type FieldSpec = { name: string; label: string; secret: boolean; placeholder: string; optional?: string; hint?: string };

function fieldsFor(c: Connection): FieldSpec[] {
  if (c.id === "ghl") {
    return [
      { name: "token", label: "Private integration token", secret: true, placeholder: "pit-…", hint: "GHL → Settings → Private Integrations. Give it contacts and custom fields." },
      { name: "locationId", label: "Location id", secret: false, placeholder: "The sub-account's id" },
    ];
  }
  return [
    { name: "baseUrl", label: "Address", secret: false, placeholder: "https://dataos.example.com" },
    {
      name: "token",
      label: "Token",
      secret: true,
      placeholder: "Paste the API token",
      ...(c.status !== "available" ? { optional: "leave empty to keep the saved one" } : {}),
    },
  ];
}

/**
 * The connect pop-up for a service with more than one field (GoHighLevel,
 * Data OS). Same look and rules as ConnectDialog: uncontrolled fields, no
 * reveal, emptied before the values are sent and whenever it closes.
 */
function FieldsConnectDialog({
  open,
  connection: c,
  onClose,
  onSubmit,
  busy,
  error,
}: {
  open: boolean;
  connection: Connection | null;
  onClose: () => void;
  onSubmit: (c: Connection, fields: Record<string, string>) => void;
  busy: boolean;
  error: string | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    form.current?.reset();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets with the fields
    setReady(false);
  }, [open, c?.id]);
  if (!c) return null;
  const specs = fieldsFor(c);
  const required = specs.filter((s) => !s.optional).map((s) => s.name);

  function values(): Record<string, string> {
    const out: Record<string, string> = {};
    const els = form.current?.elements;
    for (const s of specs) {
      const el = els?.namedItem(s.name) as HTMLInputElement | null;
      out[s.name] = (el?.value ?? "").trim();
    }
    return out;
  }

  function go() {
    if (!c) return;
    const v = values();
    if (!required.every((n) => v[n])) return;
    form.current?.reset();
    setReady(false);
    onSubmit(c, v);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="cp-conn-dialog"
      title={`Connect ${c.name}`}
      footer={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={go}>
            Save &amp; check
          </Button>
        </>
      }
    >
      <div className="cp-conn-pair" aria-hidden>
        <ConnectionLogo name={APP_NAME} size="lg" />
        <span className="cp-conn-pair-line" />
        <ConnectionLogo name={c.name} id={c.id} src={c.logo} size="lg" />
      </div>
      <p className="cp-conn-lede">
        <span className="cp-conn-lede-k">{APP_NAME} uses it for</span>
        {c.purpose}
      </p>
      {error ? (
        <p className="cp-conn-problem" role="alert">
          {error}
        </p>
      ) : null}
      <div className="cp-conn-block">
        <p className="cp-conn-label">It will be able to</p>
        <TickList size="sm" items={(c.scopes ?? []).map((s) => ({ label: s.label, detail: s.detail }))} />
      </div>
      {c.never?.length ? (
        <div className="cp-conn-block">
          <p className="cp-conn-label">It will never</p>
          <TickList size="sm" items={c.never.map((n) => ({ label: n, off: true }))} />
        </div>
      ) : null}
      <form
        ref={form}
        className="cp-conn-block"
        style={{ display: "grid", gap: 12 }}
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          go();
        }}
        onChange={() => {
          const v = values();
          setReady(required.every((n) => v[n].length >= 4) && !Object.values(v).some((x) => /\s/.test(x)));
        }}
      >
        {specs.map((s) => (
          <div className="cp-field" key={s.name}>
            <label className="cp-field-label" htmlFor={`${c.id}-${s.name}`}>
              {s.label}
              {s.optional ? <span className="cp-field-hint"> ({s.optional})</span> : null}
            </label>
            <input
              id={`${c.id}-${s.name}`}
              name={s.name}
              className="cp-input is-on-well"
              type={s.secret ? "password" : "text"}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={s.placeholder}
              data-1p-ignore=""
              data-lpignore="true"
              data-bwignore=""
              data-form-type="other"
            />
            {s.hint ? <p className="cp-field-hint">{s.hint}</p> : null}
          </div>
        ))}
        <p className="cp-field-hint">Sent once to the server and kept there encrypted. After saving you&rsquo;ll only see the last four characters.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
