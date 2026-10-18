import { describe, expect, it } from "vitest";
import {
  type ExistingContact,
  type LeadFlowPerson,
  type LeadFlowTouch,
  NOTE_PREFIX,
  indexConversations,
  isCandidate,
  leadFlowNote,
  leadFlowStage,
  mapKind,
  mapStage,
  mergeContact,
  personStage,
  resolveIdentity,
  stageTags,
  zernioTagEffects,
} from "../../lib/os/import/leadflow";
import { cleanRecord, contactFieldsFor, decideState, entryPathFor } from "../../lib/os/import/setter-state";
import type { SetterRecord } from "../../lib/os/setter/state";

const NOW = new Date("2026-10-18T12:00:00Z");
const touch = (id: string, type: string, at: number, extra: Partial<LeadFlowTouch> = {}): LeadFlowTouch => ({
  id, type, at, ...extra,
});
const person = (over: Partial<LeadFlowPerson> = {}): LeadFlowPerson => ({
  id: "p1", handle: "someone", touches: [], createdAt: 0, ...over,
});
const contact = (over: Partial<ExistingContact> = {}): ExistingContact => ({
  kind: "UNSORTED", kindSource: null, stage: "NEW", tags: [], notes: null, email: null, username: null,
  fullName: null, zernioConversationId: null, paused: false, imported: null, ...over,
});

describe("Lead Flow stage", () => {
  it("folds touches like Lead Flow's pipeline rules", () => {
    expect(leadFlowStage([])).toBeNull();
    expect(leadFlowStage([touch("a", "first_dm", 1)])).toBe("messaged");
    expect(leadFlowStage([touch("a", "first_dm", 1), touch("b", "reply", 2)])).toBe("in_conversation");
    expect(leadFlowStage([touch("a", "offer", 1), touch("b", "reply", 2)])).toBe("call_offered");
    expect(leadFlowStage([touch("a", "won", 1), touch("b", "reopened", 2)])).toBe("in_conversation");
    expect(leadFlowStage([touch("a", "first_dm", 1), touch("b", "reply", 2), touch("v", "void", 3, { voids: "b" })])).toBe(
      "messaged",
    );
    // follow-ups and engagements are not milestones
    expect(leadFlowStage([touch("a", "follow_up", 1), touch("b", "engagement", 2)])).toBeNull();
  });

  it("prefers touches, then the stats cache, then the old sheet", () => {
    expect(personStage(person({ touches: [touch("a", "first_dm", 1)], cachedStage: "won" }))).toBe("messaged");
    expect(personStage(person({ cachedStage: "in_conversation", crm: { stage: "contacted" } }))).toBe("in_conversation");
    expect(personStage(person({ crm: { stage: "contacted" } }))).toBe("contacted");
  });

  it("maps every Lead Flow stage onto a Kanban column", () => {
    expect(mapStage("messaged")).toBe("NEW");
    expect(mapStage("contacted")).toBe("NEW");
    expect(mapStage("in_conversation")).toBe("IN_CONVERSATION");
    expect(mapStage("In conversation")).toBe("IN_CONVERSATION");
    expect(mapStage("call_offered")).toBe("CALL_OFFERED");
    expect(mapStage("booked")).toBe("CALL_BOOKED");
    expect(mapStage("no_show")).toBe("CALL_BOOKED");
    expect(mapStage("showed")).toBe("SHOWED");
    expect(mapStage("pitched")).toBe("SHOWED");
    expect(mapStage("won")).toBe("WON");
    expect(mapStage("lost")).toBe("LOST");
    expect(mapStage(null)).toBeNull();
    expect(mapStage("whatever")).toBeNull();
    expect(stageTags("no_show")).toEqual(["no_show"]);
    expect(stageTags("pitched")).toEqual(["pitched"]);
    expect(stageTags("won")).toEqual([]);
  });
});

describe("Lead Flow kind and candidates", () => {
  it("friends and peers are personal, the pipeline is sales", () => {
    expect(mapKind(person({ type: "friend/peer", cachedStage: "in_conversation" }))).toBe("PERSONAL");
    expect(mapKind(person({ type: "friend_peer" }))).toBe("PERSONAL");
    expect(mapKind(person({ verdict: "peer" }))).toBe("PERSONAL");
    expect(mapKind(person({ type: "prospect", cachedStage: "messaged" }))).toBe("SALES");
    expect(mapKind(person({ cachedStage: "messaged" }))).toBe("SALES");
    expect(mapKind(person())).toBeNull();
  });

  it("leaves story-viewer-only rows behind", () => {
    expect(isCandidate(person({ type: "prospect", verdict: "no" }))).toBe(false);
    expect(isCandidate(person({ zernioParticipantId: "1" }))).toBe(true);
    expect(isCandidate(person({ cachedStage: "messaged" }))).toBe(true);
    expect(isCandidate(person({ email: "a@b.c" }))).toBe(true);
    expect(isCandidate(person({ type: "friend/peer" }))).toBe(true);
  });

  it("writes the verdict and notes into one note", () => {
    expect(leadFlowNote(person())).toBeNull();
    expect(leadFlowNote(person({ notes: "met at the meetup", verdict: "yes", verdictReason: "coach" }))).toBe(
      "met at the meetup\nverdict yes (coach)",
    );
  });
});

describe("Zernio control tags", () => {
  it("client → Won, friend → personal, agent_paused → paused", () => {
    expect(zernioTagEffects(["client"])).toEqual({ stage: "WON", kind: "SALES" });
    expect(zernioTagEffects(["friend"])).toEqual({ kind: "PERSONAL" });
    expect(zernioTagEffects(["agent_paused", "src_glow"])).toEqual({ paused: true });
    expect(zernioTagEffects(["friend", "agent_paused"])).toEqual({ kind: "PERSONAL", paused: true });
    expect(zernioTagEffects(["not_now"])).toEqual({});
  });
});

describe("identity", () => {
  const convs = indexConversations([
    { conversationId: "c1", participantId: "u1", username: "Alice" },
    { conversationId: "c2", participantId: "u2", username: "bob" },
    { conversationId: "c3", participantId: "u3", username: "bob" },
  ]);
  it("uses the participant id, then the thread, then a unique handle", () => {
    expect(resolveIdentity({ handle: "x", zernioParticipantId: "p" }, convs.byConversation, convs.byHandle).via).toBe(
      "participant",
    );
    expect(resolveIdentity({ handle: "x", zernioConversationId: "c1" }, convs.byConversation, convs.byHandle)).toEqual({
      igUserId: "u1", conversationId: "c1", via: "conversation",
    });
    expect(resolveIdentity({ handle: "@alice" }, convs.byConversation, convs.byHandle).igUserId).toBe("u1");
    // two threads under one handle: ambiguous, so unmatched
    expect(resolveIdentity({ handle: "bob" }, convs.byConversation, convs.byHandle).igUserId).toBeNull();
    expect(resolveIdentity({ handle: "nobody" }, convs.byConversation, convs.byHandle).igUserId).toBeNull();
  });
});

describe("merge rules", () => {
  const lf = { source: "leadflow" as const, sourceId: "p1" };

  it("a new contact takes everything and records what the import wrote", () => {
    const m = mergeContact(null, { ...lf, kind: "SALES", stage: "IN_CONVERSATION", tags: ["a"], note: "hi", username: "h" }, NOW);
    expect(m.data).toMatchObject({ kind: "SALES", kindSource: "import", stage: "IN_CONVERSATION", tags: ["a"], username: "h" });
    expect(m.data.notes).toBe(`${NOTE_PREFIX} hi`);
    expect(m.data.imported.leadflow).toEqual({ at: NOW.toISOString(), sourceId: "p1", stage: "IN_CONVERSATION", kind: "SALES" });
  });

  it("never overwrites a kind the user set", () => {
    const m = mergeContact(contact({ kind: "PERSONAL", kindSource: "user" }), { ...lf, kind: "SALES" }, NOW);
    expect(m.data.kind).toBeUndefined();
    expect(m.conflicts).toHaveLength(1);
  });

  it("overwrites an entry or triage kind", () => {
    expect(mergeContact(contact({ kind: "SALES", kindSource: "entry" }), { ...lf, kind: "PERSONAL" }, NOW).data.kind).toBe(
      "PERSONAL",
    );
    expect(mergeContact(contact({ kindSource: "triage" }), { ...lf, kind: "SALES" }, NOW).data.kind).toBe("SALES");
  });

  it("the first import's kind wins over the other import's", () => {
    const fromLf = contact({
      kind: "PERSONAL", kindSource: "import",
      imported: { leadflow: { at: "x", sourceId: "p1", stage: null, kind: "PERSONAL" } },
    });
    const m = mergeContact(fromLf, { source: "setter", sourceId: "c1", kind: "SALES" }, NOW);
    expect(m.data.kind).toBeUndefined();
    expect(m.conflicts[0]).toMatch(/earlier import/);
    // the same source re-importing a new value may update it
    expect(mergeContact(fromLf, { ...lf, kind: "SALES" }, NOW).data.kind).toBe("SALES");
  });

  it("moves a stage only while it is the default or still the imported one", () => {
    expect(mergeContact(contact(), { ...lf, stage: "CALL_OFFERED" }, NOW).data.stage).toBe("CALL_OFFERED");
    const imported = contact({ stage: "IN_CONVERSATION", imported: { leadflow: { at: "x", sourceId: "p1", stage: "IN_CONVERSATION", kind: null } } });
    expect(mergeContact(imported, { ...lf, stage: "CALL_OFFERED" }, NOW).data.stage).toBe("CALL_OFFERED");
    // the user moved the card since the import
    const moved = contact({ stage: "CALL_BOOKED", imported: { leadflow: { at: "x", sourceId: "p1", stage: "IN_CONVERSATION", kind: null } } });
    const m = mergeContact(moved, { ...lf, stage: "CALL_OFFERED" }, NOW);
    expect(m.data.stage).toBeUndefined();
    expect(m.conflicts[0]).toMatch(/kept CALL_BOOKED/);
    // a live contact the app already moved, never imported
    expect(mergeContact(contact({ stage: "LEAD_MAGNET_SENT" }), { ...lf, stage: "IN_CONVERSATION" }, NOW).data.stage).toBeUndefined();
    // moved back to NEW by the user after an import
    const reset = contact({ stage: "NEW", imported: { leadflow: { at: "x", sourceId: "p1", stage: "WON", kind: null } } });
    expect(mergeContact(reset, { ...lf, stage: "WON" }, NOW).data.stage).toBeUndefined();
  });

  it("keeps owning a stage it wrote when nothing changed", () => {
    const m = mergeContact(contact({ stage: "NEW" }), { ...lf, stage: "NEW" }, NOW);
    expect(m.changed).toEqual([]);
    expect(m.data.imported.leadflow?.stage).toBe("NEW");
  });

  it("unions tags, appends notes once, fills empty fields, flags a different email", () => {
    const cur = contact({ tags: ["a", "b"], notes: "mine", email: "x@y.z", username: "old" });
    const m = mergeContact(cur, { ...lf, tags: ["b", "c"], note: "from lf", email: "other@y.z", username: "new", fullName: "N" }, NOW);
    expect(m.data.tags).toEqual(["a", "b", "c"]);
    expect(m.data.notes).toBe(`mine\n\n${NOTE_PREFIX} from lf`);
    expect(m.data.email).toBeUndefined();
    expect(m.data.username).toBeUndefined();
    expect(m.data.fullName).toBe("N");
    expect(m.conflicts).toEqual([expect.stringMatching(/^email/)]);
    // second run: nothing new
    const again = mergeContact({ ...cur, tags: m.data.tags!, notes: m.data.notes!, fullName: "N" }, { ...lf, tags: ["c"], note: "from lf", fullName: "N" }, NOW);
    expect(again.changed).toEqual([]);
  });

  it("pauses but never unpauses", () => {
    expect(mergeContact(contact(), { ...lf, paused: true }, NOW).data.paused).toBe(true);
    expect(mergeContact(contact({ paused: true }), { ...lf, paused: false }, NOW).changed).toEqual([]);
  });
});

describe("J's contacts.json", () => {
  const rec = (over: Partial<SetterRecord> = {}) =>
    ({
      cid: "c1", handle: "h", contact_id: null, name: "N", state: "new", stage: null,
      entry: { via: "post_keyword", slug: "yt02", keyword: "video", at: null },
      resources_sent: [], clicked: [], their_last_at: null, our_last_at: null, last_incoming_id: null,
      last_incoming_text_id: null, delivered_at: null, opener_sent_at: null, nudges: 0, friday_last_at: null,
      window: { state: "free", until: null }, next_action: { kind: "none", at: null }, draft: null,
      proposed_tags: {}, tags: [], history: [], ...over,
    }) as SetterRecord;

  it("drops the Python caches and keeps the rest as-is", () => {
    const raw = { ...rec(), thread: [{ id: "m" }], url: "u", updated_time: "t" };
    const clean = cleanRecord(raw);
    expect(clean).toEqual(rec());
  });

  it("maps entry paths and kind", () => {
    expect(entryPathFor("post_keyword")).toBe("comment");
    expect(entryPathFor("story_keyword")).toBe("story_reply");
    expect(entryPathFor("dm_keyword")).toBe("keyword_dm");
    expect(entryPathFor("cold_dm")).toBeNull();
    expect(contactFieldsFor(rec()).kind).toBe("SALES");
    expect(contactFieldsFor(rec({ entry: { via: "cold_dm", slug: null, keyword: null, at: null } })).kind).toBeNull();
    expect(contactFieldsFor(rec({ tags: ["friend"] })).kind).toBe("PERSONAL");
    expect(contactFieldsFor(rec({ tags: ["client"] }))).toMatchObject({ kind: "SALES", stage: "WON" });
    expect(contactFieldsFor(rec({ tags: ["agent_paused"] })).paused).toBe(true);
  });

  it("keeps a SetterState J has moved on since the import", () => {
    const r = rec();
    expect(decideState(null, r, null)).toBe("create");
    expect(decideState({ record: { ...r }, updatedAt: new Date() }, r, null)).toBe("unchanged");
    const at = "2026-10-18T10:00:00.000Z";
    expect(decideState({ record: { ...r, nudges: 1 }, updatedAt: new Date("2026-10-18T10:00:01Z") }, r, at)).toBe("update");
    expect(decideState({ record: { ...r, nudges: 1 }, updatedAt: new Date("2026-10-18T11:00:00Z") }, r, at)).toBe("kept-live");
    expect(decideState({ record: { ...r, nudges: 1 }, updatedAt: new Date() }, r, null)).toBe("kept-live");
  });
});
