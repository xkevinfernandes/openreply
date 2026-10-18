import Link from "next/link";
import Composer from "@/components/os/inbox/composer";
import ContactControls from "@/components/os/inbox/contact-controls";
import ThreadList from "@/components/os/inbox/thread-list";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getThreadMessages, listThreads, type InboxMessage, type InboxThread } from "@/lib/os/inbox";
import { entryLabels, kindTabs } from "@/lib/os/labels";
import { osMockEnabled } from "@/lib/os/mock";

type PageProps = { searchParams: Promise<{ tab?: string; c?: string }> };

async function loadInbox(workspaceId: string, conversationId: string | undefined) {
  try {
    const { account, threads } = await listThreads(workspaceId);
    const selected = threads.find((t) => t.conversationId === conversationId) ?? null;
    const messages: InboxMessage[] = selected ? await getThreadMessages(workspaceId, selected.conversationId) : [];
    return { connected: Boolean(account) || osMockEnabled(), threads, selected, messages, error: null, now: Date.now() };
  } catch (err) {
    console.error("[OS Inbox] load failed:", err);
    return {
      connected: true,
      threads: [] as InboxThread[],
      selected: null,
      messages: [] as InboxMessage[],
      error: "Instagram didn't answer. Refresh in a minute; if it keeps failing, check Settings → Zernio.",
      now: Date.now(),
    };
  }
}

export default async function InboxPage({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const params = await searchParams;
  const tab = kindTabs.some((k) => k.tab === params.tab) ? params.tab! : "sales";
  const { connected, threads, selected, messages, error, now } = await loadInbox(workspaceId, params.c);

  if (!connected) {
    return (
      <div className="os-empty">
        <strong>Connect Instagram first</strong>
        The inbox reads your DMs through Zernio. Connect it in{" "}
        <Link href="/settings">Settings of the old dashboard</Link>, then come back.
      </div>
    );
  }

  return (
    <div className="os-inbox" data-thread-open={selected ? "true" : "false"}>
      <ThreadList threads={threads} tab={tab} selected={selected?.conversationId ?? null} now={now} />

      <section className="os-inbox-thread" aria-label="Conversation">
        {error && <div className="os-banner">{error}</div>}
        {!selected && !error && <div className="os-thread-placeholder">Pick a conversation.</div>}
        {selected && (
          <>
            <header className="os-thread-head">
              <Link href={`/os/inbox?tab=${tab}`} className="os-back">
                ← Back
              </Link>
              <div className="who">
                <a
                  className="name"
                  href={`https://instagram.com/${selected.username ?? ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{selected.username ?? "unknown"}
                </a>
                {selected.contact?.entryPath && (
                  <span className="chip">{entryLabels[selected.contact.entryPath] ?? selected.contact.entryPath}</span>
                )}
                {selected.contact?.kindSource === "triage" && <span className="chip quiet">J&apos;s guess</span>}
              </div>
              {selected.contact && (
                <ContactControls
                  contactId={selected.contact.id}
                  kind={selected.contact.kind}
                  stage={selected.contact.stage}
                />
              )}
            </header>

            <ol className="os-messages">
              {messages.length === 0 && <li className="os-thread-placeholder">No messages loaded.</li>}
              {messages.map((m) => (
                <li key={m.id} className={m.fromMe ? "me" : "them"}>
                  <span className="bubble">{m.text || "(attachment)"}</span>
                  {m.createdTime && (
                    <time dateTime={m.createdTime}>
                      {new Date(m.createdTime).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  )}
                </li>
              ))}
            </ol>

            <Composer igUserId={selected.igUserId} username={selected.username} />
          </>
        )}
      </section>
    </div>
  );
}
