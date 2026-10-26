"use client";

// Workspace › Sending: the daily setter send limit (only J's sends count) and
// the timezone its "today" is read in. Pause all lives in the sidebar foot.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSending } from "@/app/(os)/os/settings/actions";
import { InfoTip } from "@/components/os/ui";

export default function SendingPanel({ sendCap, timezone, canManage }: { sendCap: number; timezone: string; canManage: boolean }) {
  const router = useRouter();
  const [cap, setCap] = useState(String(sendCap));
  const [tz, setTz] = useState(timezone);
  const [msg, setMsg] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const dirty = cap !== String(sendCap) || tz !== timezone;

  return (
    <section className="os-set-section" aria-labelledby="os-set-sending">
      <header className="os-set-section-head">
        <h2 id="os-set-sending">
          Sending
          <InfoTip label="About the setter send limit">Every bubble J sends (approved or on autopilot) counts toward the limit. Workflows, campaign openers, broadcasts and your own replies don&apos;t count and aren&apos;t held by it. Pause all stops everything.</InfoTip>
        </h2>
      </header>
      <form
        className="os-send-form"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveSending({ sendCapPerDay: Number(cap), timezone: tz.trim() });
            if ("error" in r) setMsg({ error: r.error });
            else {
              setMsg({ ok: true });
              router.refresh();
            }
          });
        }}
      >
        <label>
          <span>Daily setter send limit</span>
          <input type="number" min={1} max={500} step={1} value={cap} onChange={(e) => setCap(e.target.value)} disabled={!canManage} />
        </label>
        <label>
          <span>Timezone</span>
          <input value={tz} onChange={(e) => setTz(e.target.value)} disabled={!canManage} placeholder="Europe/Luxembourg" />
        </label>
        {canManage ? (
          <button type="submit" className="os-button" disabled={pending || !dirty}>
            Save
          </button>
        ) : null}
        {msg?.error ? (
          <span className="os-send-err" role="alert">
            {msg.error}
          </span>
        ) : msg?.ok && !dirty ? (
          <span className="os-send-ok" role="status">
            Saved
          </span>
        ) : null}
      </form>
    </section>
  );
}
