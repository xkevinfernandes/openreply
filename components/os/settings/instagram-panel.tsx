"use client";

// Instagram tab: OpenReply's own Zernio connection card (components/zernio-connection.tsx),
// restyled by .os-upstream in settings.css, and a disconnect button that calls
// the same /api/instagram/disconnect route as the old Settings page.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ZernioConnection } from "@/components/zernio-connection";

export function ZernioPanel({ canManage }: { canManage: boolean }) {
  return (
    <div className="os-upstream os-set-zernio">
      <ZernioConnection canManage={canManage} />
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

/** The one Reconnect at the top of Settings › Instagram account, shown on a
 *  problem: a token/link problem runs Zernio's connect flow, a webhook-only
 *  problem re-runs the webhook repair (the same calls as the Zernio card). */
export function ReconnectBar({ problem, kind }: { problem: string; kind: "connect" | "webhook" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "connect") {
        const res = await fetch("/api/zernio/connect", { method: "POST", headers: { "Content-Type": "application/json" } });
        const p = await res.json().catch(() => ({}));
        if (!p?.success || !p.data?.authUrl) throw new Error(p?.error || "Couldn't start the Zernio connection.");
        window.location.assign(p.data.authUrl);
        return;
      }
      const cur = await fetch("/api/zernio/settings", { cache: "no-store" }).then((r) => r.json());
      const profileId = cur?.data?.profileId;
      if (!profileId) throw new Error("Pick a Zernio profile below first.");
      const res = await fetch("/api/zernio/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId }) });
      const p = await res.json().catch(() => ({}));
      if (!p?.success) throw new Error(p?.error || "Couldn't repair the webhook.");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
      setBusy(false);
    }
  };
  return (
    <div className="os-set-verdict os-set-reconnect" data-tone="bad" role="status">
      <i aria-hidden="true" />
      <span>{error ?? problem}</span>
      <button type="button" className="os-button primary" onClick={() => void run()} disabled={busy}>
        {busy ? "Opening…" : "Reconnect"}
      </button>
    </div>
  );
}
