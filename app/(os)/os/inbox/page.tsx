// Inbox A: three panes. The thread list (collapsible to an avatar rail), the
// conversation as Instagram shows it with the one composer under it, and the
// contact panel. Keys: J/K move, ⏎ approve, H hold, R regenerate, E edit.
// Owner: S1.

import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import ContactPanel from "@/components/os/contact-panel/panel";
import PanelResizer from "@/components/os/contact-panel/resizer";
import { draftBlockedReason, INBOX_LIST_COOKIE, inboxHref, threadDisplayName } from "@/components/os/inbox/categories";
import InboxList from "@/components/os/inbox/inbox-list";
import MockReply from "@/components/os/inbox/mock-reply";
import Composer, { type ComposerResource } from "@/components/os/thread/composer";
import InboxKeys from "@/components/os/thread/inbox-keys";
import { ConversationSkeleton, PanelSkeleton, ThreadListSkeleton } from "@/components/os/ui/skeleton";
import StageMover from "@/components/os/thread/stage-mover";
import ThreadHead from "@/components/os/thread/thread-head";
import ThreadView from "@/components/os/thread/thread-view";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { listThreads, loadThreadData, requestPendingDrafts, threadFromContact, type InboxThread, type ThreadData } from "@/lib/os/inbox";
import { kindTabs } from "@/lib/os/labels";
import { windowHoursLeft } from "@/lib/os/messages/view";
import { osMockEnabled } from "@/lib/os/mock";
import { mockFollowupTick } from "@/lib/os/sequences/mock-seed";
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
    const [{ account, threads }, drafts] = await Promise.all([listThreads(workspaceId), quiet(requestPendingDrafts(workspaceId), [] as DraftView[], "drafts")]);
    return { connected: Boolean(account) || osMockEnabled(), threads, drafts, error: null as string | null, now: Date.now() };
  } catch (err) {
    console.error("[OS Inbox] load failed:", err);
    return { connected: true, threads: [] as InboxThread[], drafts: [] as DraftView[], error: "Instagram didn't answer. Refresh in a minute.", now: Date.now() };
  }
}

type ListData = Awaited<ReturnType<typeof loadList>>;

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

  // Everything starts now and streams in by pane: the list waits on Zernio's
  // thread list; the open thread is found in the database so its messages and
  // panel load next to the list, not after it.
  const c = params.c ?? null;
  const list = loadList(workspaceId);
  const selected: Promise<InboxThread | null> = c
    ? quiet(threadFromContact(workspaceId, c), null, "thread contact").then((t) => t ?? list.then((l) => l.threads.find((x) => x.conversationId === c) ?? null))
    : Promise.resolve(null);
  const panel: Promise<ContactPanelData | null> = selected.then((sel) => (sel?.contact ? quiet(loadContactPanel(workspaceId, sel.contact.id), null, "panel") : null));

  return (
    <div className="os-ix" data-thread-open={c ? "true" : "false"} data-list={collapsed ? "rail" : "full"}>
      <InboxKeys />
      <Suspense fallback={<ThreadListSkeleton collapsed={collapsed} />}>
        <ListPane list={list} tab={tab} selected={c} collapsed={collapsed} />
      </Suspense>
      <Suspense key={`conv:${c ?? ""}`} fallback={c ? <ConversationSkeleton /> : <section className="os-ix-conv" />}>
        <ConversationPane workspaceId={workspaceId} list={list} selected={selected} panel={panel} tab={tab} params={params} />
      </Suspense>
      {c ? (
        <Suspense key={`panel:${c}`} fallback={<PanelSkeleton />}>
          <PanelPane selected={selected} panel={panel} />
        </Suspense>
      ) : null}
    </div>
  );
}

async function ListPane({ list, tab, selected, collapsed }: { list: Promise<ListData>; tab: string; selected: string | null; collapsed: boolean }) {
  const { connected, threads, drafts, now } = await list;
  if (!connected) {
    return (
      <div className="os-empty">
        <strong>Connect Instagram first</strong>
        The inbox reads your DMs through Zernio. Connect it in <Link href="/os/settings">Settings</Link>, then come back.
      </div>
    );
  }
  return (
    <InboxList
      threads={threads}
      tab={tab}
      selected={selected}
      now={now}
      draftContactIds={drafts.map((d) => d.contactId)}
      collapsed={collapsed}
      triageDisabled={triageDisabled()}
    />
  );
}

interface ConversationPaneProps {
  workspaceId: string;
  list: Promise<ListData>;
  selected: Promise<InboxThread | null>;
  panel: Promise<ContactPanelData | null>;
  tab: string;
  params: Awaited<PageProps["searchParams"]>;
}

async function ConversationPane({ workspaceId, list, selected: selectedP, panel: panelP, tab, params }: ConversationPaneProps) {
  const selected = await selectedP;
  if (!selected) {
    const { error, connected } = await list;
    return (
      <section className="os-ix-conv" aria-label="Conversation">
        {error ? <div className="os-banner">{error}</div> : null}
        {connected ? (
          <div className="os-ix-placeholder">
            <strong>No thread open</strong>
            Pick one, or press J.
          </div>
        ) : null}
      </section>
    );
  }

  const contact = selected.contact ?? null;
  const drafts = await quiet(requestPendingDrafts(workspaceId), [] as DraftView[], "drafts");
  const draft = contact ? (drafts.find((d) => d.contactId === contact.id) ?? null) : null;
  const now = Date.now();

  const [thread, panel, resources, voiceClips, draftVoice]: [ThreadData | null, ContactPanelData | null, ComposerResource[], VoiceClipView[], DraftVoicePreview | null] =
    await Promise.all([
      quiet(loadThreadData(workspaceId, selected.conversationId, contact?.id ?? null), null, "thread"),
      panelP,
      quiet(loadResources(workspaceId), [], "resources"),
      contact ? quiet(loadVoiceClips(workspaceId, contact.id), [], "voice clips") : [],
      draft ? quiet(previewDraftVoice(workspaceId, draft), null, "draft voice") : null,
    ]);

  const name = threadDisplayName(selected);
  const stageLabel = panel ? (panel.stage.columns.find((c) => c.key === panel.stage.column)?.label ?? null) : null;
  const triage =
    contact?.suggestedKind && (contact.kind === "UNSORTED" || (contact.kind === "PERSONAL" && contact.suggestedKind === "SALES"))
      ? { contactId: contact.id, kind: contact.kind, suggestedKind: contact.suggestedKind }
      : null;

  return (
    <section className="os-ix-conv" aria-label={`Conversation with ${name}`}>
      <StageMover contactId={contact?.id ?? null} />
      <ThreadHead
        name={name}
        username={selected.username}
        backHref={inboxHref(tab)}
        stage={contact?.kind === "SALES" ? stageLabel : null}
        stageKey={panel?.stage.column ?? null}
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
    </section>
  );
}

async function PanelPane({ selected: selectedP, panel: panelP }: { selected: Promise<InboxThread | null>; panel: Promise<ContactPanelData | null> }) {
  const [selected, panel] = await Promise.all([selectedP, panelP]);
  if (!panel) return null;
  return (
    <div className="os-ix-panel">
      <PanelResizer />
      {/* The list read refreshes the IG picture; a stored one may have expired. */}
      <ContactPanel key={panel.contactId} data={{ ...panel, avatarUrl: selected?.avatarUrl ?? panel.avatarUrl }} hideTabs={["chat"]} />
    </div>
  );
}
