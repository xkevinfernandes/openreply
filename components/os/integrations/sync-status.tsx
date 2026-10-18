import Link from "next/link";
import { shortAgo } from "@/lib/os/labels";
import type { ContactSyncLine } from "@/lib/os/integrations/view";

/** The contact's sync log, one quiet line per connected CRM. */
export default function SyncStatus({ lines, now }: { lines: ContactSyncLine[]; now: number }) {
  if (!lines.length) return null;
  return (
    <ul className="os-sync-strip" aria-label="CRM sync">
      {lines.map((l) => (
        <li key={l.provider} data-state={l.state} title={l.detail ?? undefined}>
          <i aria-hidden="true" />
          <span className="name">{l.name}</span>
          <span className="what">
            {l.state === "synced" && `synced ${shortAgo(l.at, now)} ago`}
            {l.state === "error" && (
              <Link href="/os/integrations" className="os-link">
                {l.detail ?? "sync failed"}
              </Link>
            )}
            {l.state === "waiting" && (l.detail ?? "not sent yet").toLowerCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}
