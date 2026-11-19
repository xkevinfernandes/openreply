// One view-only inbox: the client's threads on the left, the open thread on
// the right, text only. No composer, no buttons, no server actions: the page
// only reads (lib/os/view-inbox.ts, GET-only). Paging is plain links.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { partLabel } from "@/lib/os/messages/parse";
import { loadViewInbox, viewMessages, viewThreads, type ViewPage, type ViewThread } from "@/lib/os/view-inbox";
import type { RichMessage } from "@/lib/os/messages/types";
import "../view.css";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ c?: string; tc?: string; mc?: string }> };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Luxembourg" }) : "";

function href(id: string, q: { c?: string; tc?: string; mc?: string }) {
  const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  const s = p.toString();
  return `/os/view/${id}${s ? `?${s}` : ""}`;
}

export default async function ViewInboxPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) redirect(`/login?callbackUrl=/os/view/${id}`);
  const row = await loadViewInbox(workspaceId, id);
  if (!row) notFound();

  let threads: ViewPage<ViewThread> = { rows: [], cursor: null };
  let messages: ViewPage<RichMessage> | null = null;
  let error: string | null = null;
  try {
    // One read at a time (Zernio rate limits): the thread list page, then the
    // open thread's page. Nothing else is fetched.
    threads = await viewThreads(row, sp.tc ?? null);
    messages = sp.c ? await viewMessages(row, sp.c, sp.mc ?? null) : null;
  } catch (e) {
    error = e instanceof Error ? e.message : "Couldn't read from Zernio";
  }
  const open = sp.c ? threads.rows.find((t) => t.conversationId === sp.c) : undefined;

  return (
    <div className="os-view">
      <PageHead
        title={row.label}
        meta={<span className="os-view-badge">View only</span>}
        description={`@${row.username} · read from their Zernio. Nothing here can send, reply or run an automation.`}
        back={{ href: "/os/view", label: "View only" }}
      />
      {error ? <p className="os-view-empty">{error}</p> : null}
      <div className="os-view-panes">
        <ul className="os-view-threads" aria-label="Threads">
          {threads.rows.map((t) => (
            <li key={t.conversationId} data-open={t.conversationId === sp.c || undefined}>
              <Link href={href(id, { c: t.conversationId, tc: sp.tc })}>
                <strong>{t.username ? `@${t.username}` : (t.name ?? "Instagram user")}</strong>
                <time>{when(t.updatedTime)}</time>
                <span>{t.preview ?? ""}</span>
              </Link>
            </li>
          ))}
          {threads.cursor ? (
            <li className="os-view-more">
              <Link href={href(id, { tc: threads.cursor })}>Older threads</Link>
            </li>
          ) : null}
        </ul>
        <section className="os-view-thread" aria-label="Conversation">
          {!messages ? (
            <p className="os-view-empty">Pick a thread to read it.</p>
          ) : (
            <>
              <h2>{open?.username ? `@${open.username}` : (open?.name ?? "Conversation")}</h2>
              {messages.cursor ? <Link className="os-view-more" href={href(id, { c: sp.c, tc: sp.tc, mc: messages.cursor })}>Earlier messages</Link> : null}
              <ol>
                {messages.rows.map((m) => (
                  <li key={m.id} data-dir={m.direction}>
                    <p>{m.deleted ? "Unsent a message" : m.parts.map(partLabel).join(" ") || "(attachment)"}</p>
                    <time>{when(m.at)}</time>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
