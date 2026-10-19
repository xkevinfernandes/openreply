// Inbox A: three panes. The thread list (collapsible to an avatar rail), the
// conversation as Instagram shows it with the one composer under it, and the
// contact panel. Keys: J/K move, ⏎ approve, H hold, R regenerate, E edit.
// Owner: S1.

import Link from "next/link";
import { cookies } from "next/headers";
import ContactPanel from "@/components/os/contact-panel/panel";
import { draftBlockedReason, INBOX_LIST_COOKIE, inboxHref, threadDisplayName } from "@/components/os/inbox/categories";
import InboxList from "@/components/os/inbox/inbox-list";
import MockReply from "@/components/os/inbox/mock-reply";
import Composer, { type ComposerResource } from "@/components/os/thread/composer";
import InboxKeys from "@/components/os/thread/inbox-keys";
import StageMover from "@/components/os/thread/stage-mover";
import ThreadHead from "@/components/os/thread/thread-head";
import ThreadView from "@/components/os/thread/thread-view";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { listThreads, loadThreadData, type InboxThread, type ThreadData } from "@/lib/os/inbox";
import { kindTabs } from "@/lib/os/labels";
import { windowHoursLeft } from "@/lib/os/messages/view";
import { osMockEnabled } from "@/lib/os/mock";
import { mockFollowupTick } from "@/lib/os/sequences/mock-seed";
import { pendingDrafts } from "@/lib/os/setter/service";
import { resolveSetterId } from "@/lib/os/setter/setters";
import { setterStore, type DraftView } from "@/lib/os/setter/store";
import { clearSampleSuggestionsOnce, triageDisabled } from "@/lib/os/setter/triage";
import { sendableClips, type VoiceClipView } from "@/lib/os/voice/clips";
import { previewDraftVoice, type DraftVoicePreview } from "@/lib/os/voice/preview";

type PageProps = { searchParams: Promise<{ tab?: string; c?: string; voice?: string; sim?: string }> };

const quiet = <T,>(p: Promise<T>, fallback: T, what: string): Promise<T> =>
  p.catch((err) => {
    console.error(`[OS Inbox] ${what} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  });

async function loadList(workspaceId: string) {
  try {
    const [{ account, threads }, drafts] = await Promise.all([listThreads(workspaceId), quiet(pendingDrafts(workspaceId), [] as DraftView[], "drafts")]);
    return { connected: Boolean(account) || osMockEnabled(), threads, drafts, error: null as string | null, now: Date.now() };
  } catch (err) {
    console.error("[OS Inbox] load failed:", err);
    return { connected: true, threads: [] as InboxThread[], drafts: [] as DraftView[], error: "Instagram didn't answer. Refresh in a minute.", now: Date.now() };
  }
}

/** The mic's clip list (the contact's setter first). A failure hides them. */
async function loadVoiceClips(workspaceId: string, contactId: string): Promise<VoiceClipView[]> {
  const contact = await setterStore().getContact(contactId, workspaceId);
  const setterId = contact ? await resolveSetterId(contact) : null;
  return sendableClips(workspaceId, setterId);
}

/** Lead magnets the paperclip can attach (a link is its own bubble). */
async function loadResources(workspaceId: string): Promise<ComposerResource[]> {
  const rows = await prisma.resource.findMany({
    where: { workspaceId, kind: "resource", link: { not: null } },
    select: { id: true, name: true, link: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.filter((r) => r.link).map((r) => ({ id: r.id, name: r.name, link: r.link! }));
}

export default async function InboxPage({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const params = await searchParams;
  const tab = kindTabs.some((k) => k.tab === params.tab) ? params.tab! : "sales";
  const collapsed = (await cookies()).get(INBOX_LIST_COOKIE)?.value === "rail";
  // One-off: drop fake "(sample)" guesses an ungated deploy wrote (no-op after the first load).
  await clearSampleSuggestionsOnce(workspaceId);
  // Sample data has no worker: due follow-ups are drafted here (no-op otherwise).
  await mockFollowupTick().catch(() => null);

  const { connected, threads, drafts, error, now } = await loadList(workspaceId);
  if (!connected) {
    return (
      <div className="os-empty">
        <strong>Connect Instagram first</strong>
        The inbox reads your DMs through Zernio. Connect it in <Link href="/os/settings">Settings</Link>, then come back.
      </div>
    );
  }

  const selected = threads.find((t) => t.conversationId === params.c) ?? null;
  const contact = selected?.contact ?? null;
  const draft = contact ? (drafts.find((d) => d.contactId === contact.id) ?? null) : null;

  const [thread, panel, resources, voiceClips, draftVoice]: [ThreadData | null, ContactPanelData | null, ComposerResource[], VoiceClipView[], DraftVoicePreview | null] =
    await Promise.all([
      selected ? quiet(loadThreadData(workspaceId, selected.conversationId, contact?.id ?? null), null, "thread") : null,
      contact ? quiet(loadContactPanel(workspaceId, contact.id), null, "panel") : null,
      selected ? quiet(loadResources(workspaceId), [], "resources") : [],
      contact ? quiet(loadVoiceClips(workspaceId, contact.id), [], "voice clips") : [],
      draft ? quiet(previewDraftVoice(workspaceId, draft), null, "draft voice") : null,
    ]);

  const name = selected ? threadDisplayName(selected) : "";
  const stageLabel = panel ? (panel.stage.columns.find((c) => c.key === panel.stage.column)?.label ?? null) : null;
  const triage =
    contact?.suggestedKind && (contact.kind === "UNSORTED" || (contact.kind === "PERSONAL" && contact.suggestedKind === "SALES"))
      ? { contactId: contact.id, kind: contact.kind, suggestedKind: contact.suggestedKind }
      : null;

  return (
    <div className="os-ix" data-thread-open={selected ? "true" : "false"} data-list={collapsed ? "rail" : "full"}>
      <InboxKeys />
      <StageMover contactId={contact?.id ?? null} />
      <InboxList
        threads={threads}
        tab={tab}
        selected={selected?.conversationId ?? null}
        now={now}
        draftContactIds={drafts.map((d) => d.contactId)}
        collapsed={collapsed}
        triageDisabled={triageDisabled()}
      />

      <section className="os-ix-conv" aria-label={selected ? `Conversation with ${name}` : "Conversation"}>
        {error ? <div className="os-banner">{error}</div> : null}
        {!selected ? (
          <div className="os-ix-placeholder">
            <strong>No thread open</strong>
            Pick one, or press J.
          </div>
        ) : (
          <>
            <ThreadHead
              name={name}
              username={selected.username}
              backHref={inboxHref(tab)}
              stage={contact?.kind === "SALES" ? stageLabel : null}
              windowHours={thread ? windowHoursLeft(thread.messages, now) : null}
              triage={triage}
            />
            {thread ? (
              <ThreadView key={selected.conversationId} data={thread} contactId={contact?.id ?? null} who={name} avatarUrl={selected.avatarUrl ?? null} now={now} />
            ) : (
              <div className="os-ix-placeholder">Messages didn&apos;t load. Refresh in a minute.</div>
            )}
            {osMockEnabled() && params.sim === "1" ? <MockReply conversationId={selected.conversationId} who={name} /> : null}
            <Composer
              key={`${selected.conversationId}:${draft ? `${draft.id}:${draft.bubbles.join("|")}` : "none"}`}
              contactId={contact?.id ?? null}
              igUserId={selected.igUserId}
              conversationId={selected.conversationId}
              who={selected.username ? `@${selected.username}` : name}
              draft={draft}
              draftBlockedReason={draftBlockedReason(contact)}
              setterName={thread?.extras.setterName ?? panel?.setter?.name ?? "J"}
              resources={resources}
              voiceClips={voiceClips}
              draftVoice={draftVoice}
              voiceAtStart={params.voice === "1"}
            />
          </>
        )}
      </section>

      {panel ? (
        <div className="os-ix-panel">
          <ContactPanel key={panel.contactId} data={panel} hideTabs={["chat"]} />
        </div>
      ) : null}
    </div>
  );
}
