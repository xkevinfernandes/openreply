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
