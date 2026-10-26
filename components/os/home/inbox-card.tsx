// Home's inbox tile (dm-crm 031, story 66): Unread, Drafts waiting and
// Window closing, each opening the inbox filter it counts.

import Link from "next/link";
import "./home-funnel.css";
import { InfoTip } from "@/components/os/ui/info-tip";
import type { InboxCounts } from "@/lib/os/home-funnel-view";
import { inboxStreamHref } from "@/lib/os/inbox-stream";

export function InboxCard({ counts }: { counts: InboxCounts | null }) {
  const rows = counts
    ? [
        { key: "unread", label: "Unread", n: counts.unread, href: inboxStreamHref({ filter: "unread" }) },
        { key: "drafts", label: "Drafts waiting", n: counts.draftsWaiting, href: inboxStreamHref({ filter: "drafts" }) },
        { key: "window", label: "Window closing", n: counts.windowClosing, href: inboxStreamHref({ filter: "closing" }), warn: counts.windowClosing > 0 },
      ]
    : [];
  return (
    <section aria-labelledby="os-home-inbox" className="os-home-sec">
      <div className="os-home-sechead">
        <h2 id="os-home-inbox" className="os-h2">
          Inbox
        </h2>
        <Link href="/os/inbox" className="os-home-more">
          Open inbox
        </Link>
      </div>
      {counts ? (
        <>
          <div className="os-home-box">
            {rows.map((r) => (
              <Link key={r.key} href={r.href} className="os-fn-inbox" data-zero={r.n === 0 || undefined}>
                <span className="lbl">{r.label}</span>
                <span className="n" data-tone={r.warn ? "warn" : undefined}>
                  {r.n}
                </span>
              </Link>
            ))}
          </div>
          {counts.windowClosing ? (
            <p className="os-fn-window">
              {counts.windowClosing} wrote last and leave the 24-hour window within 4 hours ·{" "}
              <Link href={inboxStreamHref({ filter: "closing" })}>Show them</Link>
              <InfoTip label="About the window">Replies typed in the Instagram app can&apos;t be seen here, so a thread you answered there may still show.</InfoTip>
            </p>
          ) : null}
        </>
      ) : (
        <p className="os-home-err">Inbox counts didn&apos;t load.</p>
      )}
    </section>
  );
}
