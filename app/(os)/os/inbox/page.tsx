import Link from "next/link";
import Avatar from "@/components/os/inbox/avatar";
import Composer from "@/components/os/inbox/composer";
import { initialSource, threadName } from "@/components/os/inbox/names";
import BookedCallChip, { type BookedCall } from "@/components/os/inbox/booked-call";
import ContactControls from "@/components/os/inbox/contact-controls";
import MockReply from "@/components/os/inbox/mock-reply";
import SyncStatus from "@/components/os/integrations/sync-status";
import ThreadList from "@/components/os/inbox/thread-list";
import ThreadStrip from "@/components/os/followups/thread-strip";
import { mockFollowupTick } from "@/lib/os/sequences/mock-seed";
import { loadThreadFollowups, type ThreadFollowups } from "@/lib/os/sequences/view";
import { TriageSuggestion } from "@/components/os/inbox/triage";
import { isUnsure } from "@/lib/os/triage-copy";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getThreadMessages, listThreads, type InboxMessage, type InboxThread } from "@/lib/os/inbox";
import { activeProviders } from "@/lib/os/integrations/store";
import { contactSyncLines, type ContactSyncLine } from "@/lib/os/integrations/view";
import { entryLabels, kindTabs } from "@/lib/os/labels";
import { osMockEnabled } from "@/lib/os/mock";
import { bookingStore, calendarSource } from "@/lib/os/setter/booking-store";
import { pendingDrafts } from "@/lib/os/setter/service";
import { clearSampleSuggestionsOnce, triageDisabled } from "@/lib/os/setter/triage";
import { setterStore, type DraftView } from "@/lib/os/setter/store";
import { resolveSetterId } from "@/lib/os/setter/setters";
import VoicePlayer from "@/components/os/voice/voice-player";
import { sendableClips, type VoiceClipView } from "@/lib/os/voice/clips";
import { previewDraftVoice, type DraftVoicePreview } from "@/lib/os/voice/preview";

/** The selected contact's CRM sync log. Cheap reads; a failure hides it. */
async function loadSyncLines(workspaceId: string, contactId: string | undefined): Promise<ContactSyncLine[]> {
  if (!contactId || osMockEnabled()) return [];
  try {
    return await contactSyncLines(workspaceId, contactId, await activeProviders(workspaceId));
  } catch {
    return [];
  }
}

/** The follow-up strip for a Sales thread. A failure hides it. */
async function loadStrip(workspaceId: string, contact: { id: string; kind: string } | null | undefined): Promise<ThreadFollowups | null> {
  if (!contact || contact.kind !== "SALES") return null;
  try {
    return await loadThreadFollowups(workspaceId, contact.id);
  } catch (err) {
    console.error("[OS Inbox] follow-ups failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** The selected contact's booked call, in Kevin's time. A failure hides it. */
async function loadBookedCall(workspaceId: string, contactId: string | undefined): Promise<BookedCall | null> {
  if (!contactId) return null;
  try {
    const b = await bookingStore().latest(workspaceId, contactId);
    if (!b) return null;
    const cal = await calendarSource.forSetter(workspaceId, null).catch(() => null);
    return { start: b.start, timezone: b.timezone, hostTimezone: cal?.settings.hostTimezone ?? b.timezone, status: b.status, email: b.email };
  } catch {
    return null;
  }
}

/** The mic's clip list (the contact's setter first). A failure hides them. */
async function loadVoiceClips(workspaceId: string, contactId: string | undefined): Promise<VoiceClipView[]> {
  if (!contactId) return [];
  try {
    const contact = await setterStore().getContact(contactId, workspaceId);
    const setterId = contact ? await resolveSetterId(contact) : null;
    return await sendableClips(workspaceId, setterId);
  } catch {
    return [];
  }
}

type PageProps = { searchParams: Promise<{ tab?: string; c?: string; drafts?: string; voice?: string }> };

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
  // One-off: drop fake "(sample)" guesses an ungated deploy wrote (no-op after the first load).
  await clearSampleSuggestionsOnce(workspaceId);
  // Sample data has no worker: due follow-ups are drafted here (no-op otherwise).
  await mockFollowupTick().catch(() => null);
  const { connected, threads, selected, messages, drafts, error, now } = await loadInbox(workspaceId, params.c);
  const [syncLines, bookedCall, strip] = await Promise.all([
    loadSyncLines(workspaceId, selected?.contact?.id),
    loadBookedCall(workspaceId, selected?.contact?.id),
    loadStrip(workspaceId, selected?.contact),
  ]);
  const draftByContact = new Map(drafts.map((d) => [d.contactId, d]));
  const selectedDraft = selected?.contact ? (draftByContact.get(selected.contact.id) ?? null) : null;
  const [draftVoice, voiceClips]: [DraftVoicePreview | null, VoiceClipView[]] = await Promise.all([
    selectedDraft ? previewDraftVoice(workspaceId, selectedDraft) : Promise.resolve(null),
    loadVoiceClips(workspaceId, selected?.contact?.id),
  ]);
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
        <Link href="/os/settings">Settings</Link>, then come back.
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
        triageDisabled={triageDisabled()}
      />

      <section className="os-inbox-thread" aria-label="Conversation">
        {error && <div className="os-banner">{error}</div>}
        {!selected && !error && (
          <div className="os-thread-placeholder">
            <strong>No conversation open</strong>
            Pick one from the list.
          </div>
        )}
        {selected && (
          <>
            <header className="os-thread-head">
              <Link href={`/os/inbox?tab=${tab}`} className="os-back" aria-label="Back to conversations">
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3.5 5.5 8l4.5 4.5" />
                </svg>
              </Link>
              <div className="who">
                <Avatar src={selected.avatarUrl} username={initialSource(selected.username, selected.fullName)} size={32} />
                <span className="who-text">
                  {selected.username ? (
                    <a className="name" href={`https://instagram.com/${selected.username}`} target="_blank" rel="noreferrer">
                      {threadName(selected.username, selected.fullName)}
                    </a>
                  ) : (
                    <span className="name">{threadName(selected.username, selected.fullName)}</span>
                  )}
                  {selected.username && selected.fullName && <span className="sub">{selected.fullName}</span>}
                </span>
                {selected.contact?.entryPath && (
                  <span className="chip">{entryLabels[selected.contact.entryPath] ?? selected.contact.entryPath}</span>
                )}
                {selected.contact?.kindSource === "triage" && <span className="chip quiet">J&apos;s guess</span>}
                {selected.profile?.isFollower && <span className="os-follows">Follows you</span>}
                {bookedCall && <BookedCallChip booking={bookedCall} />}
              </div>
              {selected.contact && (
                <ContactControls
                  contactId={selected.contact.id}
                  kind={selected.contact.kind}
                  stage={selected.contact.stage}
                  onFriday={selected.contact.onFriday}
                />
              )}
            </header>

            <SyncStatus lines={syncLines} now={now} />

            {strip && selected.contact && <ThreadStrip key={selected.contact.id} contactId={selected.contact.id} data={strip} now={now} />}

            {selected.contact &&
              ((selected.contact.suggestedKind &&
                (selected.contact.kind === "UNSORTED" ||
                  (selected.contact.kind === "PERSONAL" && selected.contact.suggestedKind === "SALES"))) ||
                isUnsure(selected.contact)) && (
                <TriageSuggestion
                  key={`${selected.contact.id}-${selected.contact.suggestedKind ?? "unsure"}`}
                  contactId={selected.contact.id}
                  kind={selected.contact.kind}
                  suggestedKind={selected.contact.suggestedKind}
                  confidence={selected.contact.suggestedConfidence}
                  reason={selected.contact.suggestedReason}
                  variant="banner"
                />
              )}

            <ol className="os-messages">
              {messages.length === 0 && <li className="os-thread-placeholder">No messages loaded.</li>}
              {messages.map((m) => (
                <li key={m.id} className={m.fromMe ? "me" : "them"}>
                  {m.voice ? (
                    <VoicePlayer url={m.voice.url} durationMs={m.voice.durationMs} transcript={m.voice.transcript} tone={m.fromMe ? "me" : "plain"} />
                  ) : (
                    <span className="bubble">{m.attachment || m.text === "[image attachment]" ? "Sent a photo" : m.text || "(attachment)"}</span>
                  )}
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

            {osMockEnabled() && <MockReply conversationId={selected.conversationId} who={threadName(selected.username, selected.fullName)} />}

            <Composer
              key={selected.conversationId}
              igUserId={selected.igUserId}
              username={selected.username}
              name={threadName(selected.username, selected.fullName)}
              avatarUrl={selected.avatarUrl ?? null}
              contactId={selected.contact?.id ?? null}
              draft={selectedDraft}
              draftBlockedReason={draftBlockedReason}
              draftVoice={draftVoice}
              voiceClips={voiceClips}
              voiceAtStart={params.voice === "1"}
            />
          </>
        )}
      </section>
    </div>
  );
}
