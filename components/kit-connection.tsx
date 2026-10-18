"use client";

import { useI18n } from "@/lib/i18n/provider";
import { useCallback, useEffect, useState } from "react";

type KitData = { configured: boolean; tags: { id: string; name: string }[] };

/// Settings section: the Kit (ConvertKit) account that email gates sync into.
export function KitConnection({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<KitData | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const result = await fetch("/api/crm/kit", { cache: "no-store" }).then((r) => r.json());
    if (!result.success) throw new Error(result.error);
    setData(result.data);
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void fetch("/api/crm/kit", { cache: "no-store" })
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) throw new Error(result.error);
        setData(result.data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("Could not update connection.")));
  }, [canManage, t]);

  async function act(method: "POST" | "DELETE", body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await fetch("/api/crm/kit", {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }).then((r) => r.json());
      if (!result.success) throw new Error(result.error);
      setApiKey("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Could not update connection."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="kit-heading">
      <h2 id="kit-heading" className="text-base font-semibold text-foreground">{t("Email list (Kit)")}</h2>
      <p className="mt-1 text-sm text-muted">
        {t("Campaigns with an email gate ask for an email before the link and add it to Kit, tagged per campaign.")}
      </p>
      {!canManage ? (
        <p className="mt-4 text-sm">{t("Ask your workspace owner or admin to connect Kit.")}</p>
      ) : (
        <>
          {error && <p role="alert" className="mt-4 rounded border border-error/30 bg-white p-3 text-sm text-error">{error}</p>}
          {!data?.configured ? (
            <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void act("POST", { apiKey }); }}>
              <label className="block text-sm font-medium" htmlFor="kit-api-key">{t("Kit API key")}</label>
              <input id="kit-api-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} required className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm" />
              <p className="text-xs leading-5 text-muted">{t("A v4 API key from Kit → Settings → Developer. It is encrypted and never shown again.")}</p>
              <button disabled={busy || !apiKey} className="rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busy ? t("Saving…") : t("Connect Kit")}</button>
            </form>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-sm">{t("Kit connected. {count} tags available.", { count: data.tags.length })}</p>
              <button disabled={busy} onClick={() => void act("DELETE")} className="rounded-lg border border-border bg-white px-3 py-2 text-sm disabled:opacity-50">{t("Disconnect Kit")}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
