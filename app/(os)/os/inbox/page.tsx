import Link from "next/link";
import Avatar from "@/components/os/inbox/avatar";
import Composer from "@/components/os/inbox/composer";
import ContactControls from "@/components/os/inbox/contact-controls";
import ThreadList from "@/components/os/inbox/thread-list";
import { TriageSuggestion } from "@/components/os/inbox/triage";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getThreadMessages, listThreads, type InboxMessage, type InboxThread } from "@/lib/os/inbox";
import { entryLabels, kindTabs } from "@/lib/os/labels";
import { osMockEnabled } from "@/lib/os/mock";
import { pendingDrafts } from "@/lib/os/setter/service";
import type { DraftView } from "@/lib/os/setter/store";

type PageProps = { searchParams: Promise<{ tab?: string; c?: string; drafts?: string }> };

async function loadInbox(workspaceId: string, conversationId: string | undefined) {
  try {
    const { account, threads } = await listThreads(workspaceId);
    const selected = threads.find((t) => t.conversationId === conversationId) ?? null;
    const [messages, drafts] = await Promise.all([
      selected ? getThreadMessages(workspaceId, selected.conversationId) : Promise.resolve([] as InboxMessage[]),
      pendingDrafts(workspaceId).catch((err) => {
        console.error("[OS Inbox] drafts failed:", err);
        return [] as DraftView[];
      }),
    ]);
    return { connected: Boolean(account) || osMockEnabled(), threads, selected, messages, drafts, error: null, now: Date.now() };
  } catch (err) {
    console.error("[OS Inbox] load failed:", err);
    return {
      connected: true,
      threads: [] as InboxThread[],
      selected: null,
      messages: [] as InboxMessage[],
      drafts: [] as DraftView[],
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
  const { connected, threads, selected, messages, drafts, error, now } = await loadInbox(workspaceId, params.c);
  const draftByContact = new Map(drafts.map((d) => [d.contactId, d]));
  const selectedDraft = selected?.contact ? (draftByContact.get(selected.contact.id) ?? null) : null;
  const draftBlockedReason = !selected?.contact
    ? "Not a contact yet."
    : selected.contact.kind === "PERSONAL" && selected.contact.suggestedKind === "SALES"
      ? "This looks like a question about your offer. J only drafts once you move them to Sales."
      : selected.contact.kind !== "SALES"
      ? "J drafts for Sales contacts only. Move this one to Sales first."
      : selected.contact.paused
        ? "J is paused for this contact."
        : null;

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
      <ThreadList
        threads={threads}
        tab={tab}
        selected={selected?.conversationId ?? null}
        now={now}
        draftContactIds={[...draftByContact.keys()]}
        draftsOnly={params.drafts === "1"}
      />

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
                <Avatar src={selected.avatarUrl} username={selected.username} size={32} />
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
                {selected.profile?.isFollower && <span className="os-follows">Follows you</span>}
              </div>
              {selected.contact && (
                <ContactControls
                  contactId={selected.contact.id}
                  kind={selected.contact.kind}
                  stage={selected.contact.stage}
                />
              )}
            </header>

            {selected.contact?.suggestedKind &&
              (selected.contact.kind === "UNSORTED" ||
                (selected.contact.kind === "PERSONAL" && selected.contact.suggestedKind === "SALES")) && (
                <TriageSuggestion
                  key={`${selected.contact.id}-${selected.contact.suggestedKind}`}
                  contactId={selected.contact.id}
                  kind={selected.contact.kind}
                  suggestedKind={selected.contact.suggestedKind}
                  reason={selected.contact.suggestedReason}
                  variant="banner"
                />
              )}

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

            <Composer
              key={selected.conversationId}
              igUserId={selected.igUserId}
              username={selected.username}
              avatarUrl={selected.avatarUrl ?? null}
              contactId={selected.contact?.id ?? null}
              draft={selectedDraft}
              draftBlockedReason={draftBlockedReason}
            />
          </>
        )}
      </section>
    </div>
  );
}
