// The one-stream inbox (dm-crm 009, 011, 012, 014): unread, filters, window
// display at its boundaries, the spam heuristic on its fixtures, the inbound
// ingest and Kevin's actions on sample data.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { real, scams } from "./fixtures/spam-dms";
import {
  EMPTY_CRM,
  filterCounts,
  filterStream,
  inboxStreamHref,
  isUnread,
  laterIso,
  matchesStatus,
  parseInboxParams,
  sortStream,
  unreadMark,
  windowClosing,
  windowDisplay,
  type StreamThread,
  type ThreadCrm,
} from "@/lib/os/inbox-stream";
import { inboundPatch, type InboundState } from "@/lib/os/inbox-crm";
import { isSpam, looksLikeScam, shouldFlagSpam } from "@/lib/os/spam";
import { streamRows } from "@/components/os/inbox/categories";

const H = 3600_000;
const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * H).toISOString();

let n = 0;
function thread(crm: Partial<ThreadCrm> = {}, over: Partial<StreamThread> & { kind?: "SALES" | "PERSONAL" | "PITCHES" | "UNSORTED" } = {}): StreamThread {
  const id = `c${++n}`;
  const { kind = "SALES", ...rest } = over;
  return {
    conversationId: `m${n}`,
    igUserId: `${n}`,
    username: `user${n}`,
    preview: "hi",
    updatedTime: ago(1),
    unreadCount: 0,
    contact: {
      id,
      kind,
      kindSource: "entry",
      stage: "IN_CONVERSATION",
      entryPath: null,
      setterStage: "qualify",
      paused: false,
      suggestedKind: null,
      suggestedReason: null,
      suggestedConfidence: null,
      suggestedBy: null,
      triagedMessageId: null,
      onFriday: false,
      seenAt: null,
    },
    crm: { ...EMPTY_CRM, ...crm },
    ...rest,
  };
}

const ctx = (drafts: string[] = []) => ({ now: NOW, draftContactIds: new Set(drafts) });

describe("unread", () => {
  const migrated = ago(10); // the migration time: every existing thread starts read
  it("an old thread is read after migration", () => {
    expect(isUnread({ lastInboundAt: ago(48), lastOpenedAt: migrated })).toBe(false);
  });
  it("a new inbound afterwards makes it unread", () => {
    expect(isUnread({ lastInboundAt: ago(1), lastOpenedAt: migrated })).toBe(true);
  });
  it("Mark unread (opened cleared) puts it back; opening marks read", () => {
    expect(isUnread({ lastInboundAt: ago(48), lastOpenedAt: null })).toBe(true);
    expect(isUnread({ lastInboundAt: ago(1), lastOpenedAt: ago(0) })).toBe(false);
  });
  it("comment-only contacts (no inbound DM) are never unread", () => {
    expect(isUnread({ lastInboundAt: null, lastOpenedAt: null })).toBe(false);
  });
  it("local unread wins over Zernio's count", () => {
    expect(unreadMark({ crm: { ...EMPTY_CRM, lastInboundAt: ago(5), lastOpenedAt: ago(1) }, unreadCount: 3 })).toBeNull();
    expect(unreadMark({ crm: { ...EMPTY_CRM, lastInboundAt: ago(1), lastOpenedAt: ago(5) }, unreadCount: 3 })).toEqual({ count: 3 });
    expect(unreadMark({ crm: { ...EMPTY_CRM, lastInboundAt: ago(1), lastOpenedAt: null }, unreadCount: 0 })).toEqual({ count: null });
  });
});

describe("filters", () => {
  const unread = thread({ lastInboundAt: ago(1) });
  const read = thread({ lastInboundAt: ago(3), lastOpenedAt: ago(2), lastOutboundAt: ago(2) }, { updatedTime: ago(3) });
  const starred = thread({ starred: true }, { updatedTime: ago(30) });
  const old = thread({}, { updatedTime: ago(24 * 10) });
  const spam = thread({ spam: true, lastInboundAt: ago(1) });
  const spamDraft = thread({ spam: true, lastInboundAt: ago(21) });
  const archived = thread({ archivedAt: ago(5), lastInboundAt: ago(21) });
  const closing = thread({ lastInboundAt: ago(21), lastOutboundAt: ago(30) }, { kind: "PERSONAL", updatedTime: ago(21) });
  const all = [old, unread, read, starred, spam, spamDraft, archived, closing];
  const drafts = [read.contact!.id, spamDraft.contact!.id, archived.contact!.id];

  it("the stream is newest first and leaves out spam and archived", () => {
    const rows = filterStream(all, "all", "any", ctx(drafts));
    expect(rows.map((t) => t.conversationId)).toEqual([unread, read, closing, starred, old].map((t) => t.conversationId));
  });
  it("spam never counts towards Unread; the Spam filter shows the count", () => {
    const c = filterCounts(all, "any", ctx(drafts));
    expect(c.unread).toBe(2); // unread + closing (never opened since)
    expect(c.spam).toBe(2);
    expect(c.archived).toBe(1);
  });
  it("Drafts waiting and Window closing leave out spam and archived", () => {
    expect(filterStream(all, "drafts", "any", ctx(drafts))).toEqual([read]);
    expect(filterStream(all, "closing", "any", ctx(drafts))).toEqual([closing]);
  });
  it("Starred, Recent and the category filter", () => {
    expect(filterStream(all, "starred", "any", ctx())).toEqual([starred]);
    expect(filterStream(all, "recent", "any", ctx()).includes(old)).toBe(false);
    expect(filterStream(all, "all", "personal", ctx())).toEqual([closing]);
  });
  it("Window closing: they wrote last and under 4 hours left", () => {
    expect(windowClosing({ lastInboundAt: ago(20.5), lastOutboundAt: null }, NOW)).toBe(true);
    expect(windowClosing({ lastInboundAt: ago(19), lastOutboundAt: null }, NOW)).toBe(false);
    expect(windowClosing({ lastInboundAt: ago(25), lastOutboundAt: null }, NOW)).toBe(false);
    expect(windowClosing({ lastInboundAt: ago(21), lastOutboundAt: ago(20) }, NOW)).toBe(false);
  });
  it("a new message moves its thread to the top", () => {
    const moved = { ...old, updatedTime: laterIso(old.updatedTime, ago(0.1)) };
    expect(sortStream([unread, read, moved])[0]).toBe(moved);
  });
  it("rows: stage pill on Sales, Draft, unread dot, star", () => {
    const rows = streamRows([unread, read, starred, closing], { params: { filter: "all", cat: "any" }, draftContactIds: [read.contact!.id], selected: null, now: NOW });
    expect(rows[0].unread).toEqual({ count: null });
    expect(rows[1].draft).toBe(true);
    expect(rows[2].starred).toBe(true);
    expect(rows[3].stage).toBeNull();
    expect(rows[0].stage).not.toBeNull();
  });
});

describe("URLs", () => {
  it("old tab URLs land on the category filter, keeping the open thread", () => {
    expect(parseInboxParams({ tab: "sales" }).redirect).toBe("/os/inbox?cat=sales");
    expect(parseInboxParams({ tab: "unsorted", c: "m3" }).redirect).toBe("/os/inbox?cat=unsorted&c=m3");
    expect(parseInboxParams({ tab: "nope" }).redirect).toBe("/os/inbox");
  });
  it("filters round-trip; Home's ?drafts=1 is Drafts waiting", () => {
    const p = parseInboxParams({ f: "closing", cat: "pitches" });
    expect(p).toMatchObject({ filter: "closing", cat: "pitches", redirect: null });
    expect(inboxStreamHref(p, "m1")).toBe("/os/inbox?f=closing&cat=pitches&c=m1");
    expect(parseInboxParams({ drafts: "1" }).filter).toBe("drafts");
    expect(parseInboxParams({ f: "bogus" }).filter).toBe("all");
    // Home's inbox card links.
    expect(parseInboxParams({ filter: "unread" }).filter).toBe("unread");
    expect(parseInboxParams({ filter: "drafts" }).filter).toBe("drafts");
    expect(parseInboxParams({ filter: "window" }).filter).toBe("closing");
  });
});

describe("window display (display only)", () => {
  const z = { zernio: true, tz: "UTC" };
  it("just inside 24 hours: the standard window with time left", () => {
    const w = windowDisplay(ago(23.9), NOW, z);
    expect(w.kind).toBe("standard");
    expect(w.label).toContain("6m left");
    expect(w.sub).toContain("human-agent");
  });
  it("just past 24 hours with Zernio: the human-agent window", () => {
    expect(windowDisplay(ago(24.01), NOW, z).kind).toBe("human_agent");
  });
  it("just inside 7 days: still human-agent; just past: closed", () => {
    expect(windowDisplay(ago(24 * 7 - 0.01), NOW, z).kind).toBe("human_agent");
    expect(windowDisplay(ago(24 * 7 + 0.01), NOW, z).kind).toBe("closed");
  });
  it("no Zernio connection: closed once the 24 hours are past", () => {
    expect(windowDisplay(ago(23), NOW, { zernio: false }).kind).toBe("standard");
    expect(windowDisplay(ago(23), NOW, { zernio: false }).sub).toBeNull();
    expect(windowDisplay(ago(25), NOW, { zernio: false }).kind).toBe("closed");
  });
  it("never says closed while it can still send", () => {
    for (let h = 0; h < 24 * 7; h += 0.5) expect(windowDisplay(ago(h), NOW, z).kind).not.toBe("closed");
    for (let h = 0; h < 24; h += 0.5) expect(windowDisplay(ago(h), NOW, { zernio: false }).kind).not.toBe("closed");
  });
  it("they never wrote: no window line", () => {
    expect(windowDisplay(null, NOW, z).kind).toBe("none");
  });
});

describe("spam heuristic on the fixtures", () => {
  it("zero false positives on real messages with links", () => {
    expect(real.length).toBeGreaterThanOrEqual(20);
    expect(real.filter((t) => looksLikeScam(t))).toEqual([]);
  });
  it("catches at least 8 of 10 scams", () => {
    expect(scams.length).toBeGreaterThanOrEqual(10);
    const caught = scams.filter((t) => looksLikeScam(t)).length;
    expect(caught / scams.length).toBeGreaterThanOrEqual(0.8);
  });
  it("needs both a link and impersonation wording", () => {
    expect(looksLikeScam("Activate your account to get the blue badge")).toBe(false);
    expect(looksLikeScam("check https://example.com/x")).toBe(false);
  });
  it("never flags a contact with a personal send or in Personal", () => {
    const base = { spam: false, spamOverride: null };
    expect(shouldFlagSpam({ ...base, kind: "SALES", lastPersonalSendAt: ago(5) }, scams[0])).toBe(false);
    expect(shouldFlagSpam({ ...base, kind: "PERSONAL", lastPersonalSendAt: null }, scams[0])).toBe(false);
    expect(shouldFlagSpam({ ...base, kind: "UNSORTED", lastPersonalSendAt: null }, scams[0])).toBe(true);
  });
});

describe("inbound ingest", () => {
  const cur = (over: Partial<InboundState> = {}): InboundState => ({
    kind: "UNSORTED",
    lastInboundAt: new Date(NOW - 5 * H),
    lastMessageAt: new Date(NOW - 5 * H),
    lastPersonalSendAt: null,
    spam: false,
    spamOverride: null,
    archivedAt: null,
    ...over,
  });
  const at = new Date(NOW);

  it("sets last inbound and moves the last message time later only", () => {
    expect(inboundPatch(cur(), { text: "hi", at })).toEqual({ lastInboundAt: at, lastMessageAt: at });
    expect(inboundPatch(cur({ lastInboundAt: new Date(NOW + H), lastMessageAt: new Date(NOW + H) }), { text: "hi", at })).toEqual({});
  });
  it("a new inbound un-archives an archived contact", () => {
    expect(inboundPatch(cur({ archivedAt: new Date(NOW - 48 * H) }), { text: "back again", at }).archivedAt).toBeNull();
  });
  it("flags a scam; overrides stick in both directions across further inbound", () => {
    expect(inboundPatch(cur(), { text: scams[0], at }).spam).toBe(true);
    // Not spam (override false): a further scam message never re-flips it.
    const notSpam = cur({ spam: true, spamOverride: false });
    expect(inboundPatch(notSpam, { text: scams[1], at }).spam).toBeUndefined();
    expect(isSpam(notSpam)).toBe(false);
    // Mark spam (override true): a further clean message never clears it.
    const marked = cur({ spamOverride: true });
    expect(inboundPatch(marked, { text: "hi again", at }).spam).toBeUndefined();
    expect(isSpam(marked)).toBe(true);
  });
});

describe("on sample data (OS_MOCK)", () => {
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env.OS_MOCK;
    process.env.OS_MOCK = "1";
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.OS_MOCK;
    else process.env.OS_MOCK = prev;
  });

  it("inbound un-archives and makes unread; opening reads; Mark unread puts it back", async () => {
    const { recordInbound, markOpened, markUnread } = await import("@/lib/os/inbox-crm");
    const { mockCrmState } = await import("@/lib/os/mock-crm");
    expect(mockCrmState("c10").archivedAt).not.toBeNull();
    await recordInbound({ workspaceId: "w", contactId: "c10", text: "hey, back again" });
    expect(mockCrmState("c10").archivedAt).toBeNull();
    expect(isUnread(mockCrmState("c10"))).toBe(true);
    await markOpened("w", "c10");
    expect(isUnread(mockCrmState("c10"))).toBe(false);
    await markUnread("w", ["c10"]);
    expect(isUnread(mockCrmState("c10"))).toBe(true);
  });

  it("star, archive and the spam override persist", async () => {
    const { setArchived, setSpamOverride, setStarred, recordInbound } = await import("@/lib/os/inbox-crm");
    const { mockStream } = await import("@/lib/os/mock-inbox");
    await setStarred("w", ["c4"], true);
    await setArchived("w", ["c6"], true);
    await setSpamOverride("w", ["c7"], false);
    await recordInbound({ workspaceId: "w", contactId: "c7", text: scams[0] });
    const s = mockStream();
    const by = (id: string) => s.find((t) => t.contact?.id === id)!;
    expect(matchesStatus(by("c4"), "starred", ctx())).toBe(true);
    expect(matchesStatus(by("c6"), "archived", ctx())).toBe(true);
    expect(matchesStatus(by("c6"), "all", ctx())).toBe(false);
    expect(isSpam(by("c7").crm)).toBe(false);
    await setArchived("w", ["c6"], false);
    expect(matchesStatus(mockStream().find((t) => t.contact?.id === "c6")!, "all", ctx())).toBe(true);
  });

  it("bulk Won / Lost go through the stage writer and log; bulk tag through the tag writer", async () => {
    const { editContacts } = await import("@/lib/os/contacts-edit");
    const { mockStageLog } = await import("@/lib/os/mock-crm");
    const { mockContact, mockContactExtras } = await import("@/lib/os/mock");
    const r = await editContacts("w", ["c8", "c3"], { type: "stage", stage: "LOST" });
    expect(r.error).toBeUndefined();
    expect(mockContact("c8")!.contact.stage).toBe("LOST");
    expect(mockStageLog("c8")[0]).toMatchObject({ toColumn: "lost", outcome: "applied", cause: "user" });
    const t = await editContacts("w", ["c8", "c3"], { type: "addTag", tag: "hot" });
    expect(t.error).toBeUndefined();
    expect(mockContactExtras("c8").tags).toContain("hot");
  });
});
