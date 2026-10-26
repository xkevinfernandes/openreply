"use client";

// Settings › Instagram account pieces: the Zernio card (DM OS copy, same
// /api/zernio routes as OpenReply's card), Disconnect, and the one fix button
// every screen uses (this tab, Integrations, Diagnostics). The fix is the one
// the stated problem needs (lib/os/connections.ts): Reconnect runs Zernio's
// connect flow, Fix webhook repairs the webhook, Set up Zernio opens the key
// form. On the OS_MOCK sample nothing calls Zernio.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { fixSampleWebhook } from "@/app/(os)/os/settings/actions";
import { fixLabel, type InstagramFix } from "@/lib/os/connections-view";

type ConnectionData = {
  configured: boolean;
  profileId?: string | null;
  webhookReady?: boolean;
  profiles: { id: string; name: string }[];
  accounts: { id: string; username: string; instagramId: string; connected?: boolean }[];
};

async function zernio(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`/api/zernio/${path}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const p = await res.json().catch(() => ({}));
  if (!p?.success) throw new Error(p?.error || "Zernio didn't answer. Try again.");
  return p.data;
}

/** Runs the fix for the stated problem. "zernio" is a link to the key form. */
async function runFix(fix: Exclude<InstagramFix, "zernio">, sample: boolean): Promise<void> {
  if (sample) {
    const r = await fixSampleWebhook();
    if ("error" in r) throw new Error(r.error);
    return;
  }
  if (fix === "connect") {
    const d = await zernio("connect", "POST");
    if (!d?.authUrl) throw new Error("Couldn't start the Zernio connection.");
    window.location.assign(d.authUrl);
    return;
  }
  const cur = await zernio("settings");
  if (!cur?.profileId) throw new Error("Pick a Zernio profile first.");
  await zernio("settings", "PUT", { profileId: cur.profileId });
}

export function InstagramFixButton({
  fix,
  sample,
  className = "os-button primary",
  onDone,
  onError,
}: {
  fix: InstagramFix;
  sample: boolean;
  className?: string;
  /** After the fix ran (default: refresh the page). */
  onDone?: () => void;
  onError?: (message: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = fixLabel(fix);
  if (fix === "zernio" || (sample && fix !== "webhook")) {
    return (
      <Link href="/os/settings?tab=instagram#zernio" className={className}>
        {label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await runFix(fix, sample);
          if (onDone) onDone();
          else router.refresh();
        } catch (e) {
          onError?.(e instanceof Error ? e.message : "That didn't work. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (fix === "connect" ? "Opening…" : "Fixing…") : label}
    </button>
  );
}

/** The bar at the top of Settings › Instagram account while there's a problem. */
export function ReconnectBar({ problem, fix, sample }: { problem: string; fix: InstagramFix; sample: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="os-set-verdict os-set-reconnect" data-tone="bad" role="status">
      <i aria-hidden="true" />
      <span>{error ?? problem}</span>
      <InstagramFixButton fix={fix} sample={sample} onError={setError} />
    </div>
  );
}

export function DisconnectButton({ id, username }: { id: string; username: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="os-set-disconnect">
      <button
        type="button"
        className="os-button danger"
        disabled={busy}
        onClick={async () => {
          if (!confirm(`Disconnect @${username}? Its automations stop sending DMs and J stops reading its inbox.`)) return;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/instagram/disconnect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ instagramAccountId: id }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) throw new Error(data.error || "Couldn't disconnect it.");
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't disconnect it.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Disconnecting…" : "Disconnect"}
      </button>
      {error && (
        <span className="os-kb-note" data-kind="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

/** Zernio: the key, the profile (and its webhook) and which account the DM OS uses. */
export function ZernioPanel({ canManage, sample = null, embedded = false }: { canManage: boolean; sample?: { username: string } | null; embedded?: boolean }) {
  const [data, setData] = useState<ConnectionData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const d = (await zernio("settings")) as ConnectionData;
    setData(d);
    setProfileId(d.profileId ?? "");
  }, []);

  useEffect(() => {
    if (!canManage || sample) return;
    let live = true;
    zernio("settings")
      .then((d: ConnectionData) => {
        if (!live) return;
        setData(d);
        setProfileId(d.profileId ?? "");
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Couldn't load the Zernio connection."));
    return () => {
      live = false;
    };
  }, [canManage, sample]);

  const act = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const d = await zernio(path, method, body);
      setApiKey("");
      if (d?.authUrl) return window.location.assign(d.authUrl);
      if (path === "accounts") return window.location.reload();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const body = sample ? (
    <ul className="os-zn-facts">
      <li>Key saved</li>
      <li>Webhook set up</li>
      <li>@{sample.username} · used by the DM OS</li>
    </ul>
  ) : !canManage ? (
    <p className="os-set-empty">Ask the workspace owner or an admin to set up Zernio.</p>
  ) : !data ? (
    error ? null : <p className="os-set-empty">Loading…</p>
  ) : !data.configured ? (
    <form
      className="os-si-form"
      onSubmit={(e) => {
        e.preventDefault();
        void act("settings", "POST", { apiKey });
      }}
    >
      <label>
        <span>Zernio API key</span>
        <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required />
      </label>
      <div className="os-si-form-actions">
        <a className="os-zn-link" href="https://zernio.com/signup" target="_blank" rel="noreferrer">
          Get a key
        </a>
        <span className="os-si-grow" />
        <button className="os-si-btn primary" disabled={busy || !apiKey}>
          {busy ? "Saving…" : "Save key"}
        </button>
      </div>
    </form>
  ) : (
    <div className="os-zn-body">
      <form
        className="os-si-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act("settings", "PUT", { profileId });
        }}
      >
        <label>
          <span>Profile</span>
          <select className="os-input" value={profileId} onChange={(e) => setProfileId(e.target.value)} required>
            <option value="">Pick a profile</option>
            {data.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {!data.profiles.length ? <p className="os-set-empty">Make a profile in Zernio, then reload this page.</p> : null}
        <div className="os-si-form-actions">
          <span className="os-si-grow" />
          <button className="os-si-btn primary" disabled={busy || !profileId}>
            {busy ? "Setting up…" : data.webhookReady && profileId === data.profileId ? "Repair webhook" : "Save and set up webhook"}
          </button>
        </div>
      </form>
      {data.webhookReady ? (
        <ul className="os-zn-accounts">
          {data.accounts.map((a) => (
            <li key={a.id}>
              <span>@{a.username}</span>
              <button type="button" className="os-si-btn" disabled={busy || a.connected} onClick={() => void act("accounts", "POST", { accountId: a.id })}>
                {a.connected ? "In use" : "Use this account"}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="os-si-btn" disabled={busy} onClick={() => void act("connect", "POST")}>
              Connect another account
            </button>
          </li>
        </ul>
      ) : null}
      <button
        type="button"
        className="os-zn-remove"
        disabled={busy}
        onClick={() => {
          if (confirm("Remove the Zernio key and its webhook? Disconnect its Instagram accounts first.")) void act("settings", "DELETE");
        }}
      >
        Remove Zernio
      </button>
    </div>
  );
  const err = error ? (
    <p className="os-tg-error" role="alert">
      {error}
    </p>
  ) : null;

  if (embedded) {
    return (
      <div className="os-zn" id="zernio">
        {body}
        {err}
      </div>
    );
  }
  return (
    <section className="os-set-section os-zn" id="zernio" aria-labelledby="os-zn-title">
      <header className="os-set-section-head">
        <h2 id="os-zn-title">Zernio</h2>
        <p>Connects Instagram without your own Meta app. Its key needs Inbox access and is stored encrypted.</p>
      </header>
      {body}
      {err}
    </section>
  );
}
