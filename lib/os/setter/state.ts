// J's per-contact state machine. A line-for-line port of
// DM Setter/scripts/dms/state_lib.py: pure, no IO, no clock, no network.
//
//   rec = observe(rec, msgs, tags, catalog, now, cfg)   // fold facts in
//   [rec, action] = advance(rec, now, cfg)              // timers -> transition
//
// The record keeps the Python field names (snake_case) on purpose: it is
// stored as JSON in SetterState.record, and step 8 imports contacts.json into
// the same shape without a mapping layer.
//
// `msgs` are oldest-first: {id, text, incoming, at, story_reply, postback}. A
// postback tap IS an incoming message (Meta counts it; it opens the 24h
// window), so it moves their_last_at, but it is not "text they said", so it
// never triggers a reply draft on its own; the timer does that.

import type { CatalogRow } from "@/lib/os/setter/types";

export const STATES = [
  "new",
  "offered",
  "delivered",
  "setter_open",
  "in_conversation",
  "booked",
  "not_now",
  "unreachable",
  "frozen",
] as const;
export type SetterStateName = (typeof STATES)[number];

export const FREEZE_TAGS = ["client", "friend", "agent_paused"];

export const DEFAULT_TIMERS = {
  value_opener_delay_minutes: 30,
  nudge_after_hours: 6,
  nudge_max: 1,
  offer_expires_days: 7,
  stale_days: 10,
  free_window_hours: 24,
  human_agent_days: 7,
  window_safety_minutes: 60,
};
export type Timers = typeof DEFAULT_TIMERS;

export interface StateConfig {
  timers?: Partial<Timers>;
}

export type EntryVia =
  | "setter_keyword"
  | "setter_comment"
  | "post_keyword"
  | "story_keyword"
  | "dm_keyword"
  | "cold_dm"
  | "we_opened"
  | "unknown";

export interface Entry {
  via: EntryVia;
  slug: string | null;
  keyword: string | null;
  at: string | null;
}

export type WindowState = "free" | "human_agent" | "closed";
export type ActionKind = "reply" | "value_opener" | "nudge";

export interface ThreadMessage {
  id: string;
  text: string;
  incoming: boolean;
  at: string;
  story_reply?: boolean;
  postback?: boolean;
}

export interface SetterAction {
  kind: ActionKind;
  anchor: string;
  human_agent: boolean;
}

export interface SetterRecord {
  cid: string;
  handle: string;
  contact_id: string | null;
  name: string;
  state: SetterStateName;
  stage: string | null;
  entry: Entry | null;
  resources_sent: string[];
  clicked: string[];
  their_last_at: string | null;
  our_last_at: string | null;
  last_incoming_id: string | null;
  last_incoming_text_id: string | null;
  last_incoming_text_at?: string | null;
  delivered_at: string | null;
  opener_sent_at: string | null;
  nudges: number;
  friday_last_at: string | null;
  window: { state: WindowState; until: string | null };
  next_action: { kind: ActionKind | "none"; at: string | null };
  draft: { anchor: string; kind: string; draft_id?: string; stage?: string; offer?: string | null } | null;
  proposed_tags: Record<string, string>;
  tags: string[];
  history: { at: string | null; event: string }[];
  email?: string;
  skipped_anchors?: string[];
  triaged_msg_id?: string | null;
  invited?: { route: string; offer?: string | null; at: string } | null;
  fit_score?: number | null;
  sends?: { at: string; kind: string; edited: boolean; human_agent: boolean; bubbles: string[]; first: boolean }[];
}

// ---------------------------------------------------------------- time
type TimeLike = string | Date | null | undefined;

export function parseIso(s: TimeLike): Date | null {
  if (!s) return null;
  if (s instanceof Date) return s;
  let str = String(s).trim();
  // Python's fromisoformat treats a bare timestamp as UTC here; JS would read local time.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(str)) str += "Z";
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-09-14T10:00:00Z": seconds precision, like state_lib.iso(). */
export function iso(dt: Date | null): string | null {
  if (!dt) return null;
  return dt.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function timers(cfg?: StateConfig): Timers {
  return { ...DEFAULT_TIMERS, ...(cfg?.timers ?? {}) };
}

// ---------------------------------------------------------------- window
/** A thread where they never sent anything (comment-only, no tap) is closed:
 *  Meta gives us no window. */
export function windowState(theirLastAt: TimeLike, now: TimeLike, cfg?: StateConfig): [WindowState, string | null] {
  const t = timers(cfg);
  const last = parseIso(theirLastAt);
  const n = parseIso(now)!;
  if (!last) return ["closed", null];
  const safety = t.window_safety_minutes * MIN;
  const freeUntil = new Date(last.getTime() + t.free_window_hours * HOUR - safety);
  const haUntil = new Date(last.getTime() + t.human_agent_days * DAY - safety);
  if (n < freeUntil) return ["free", iso(freeUntil)];
  if (n < haUntil) return ["human_agent", iso(haUntil)];
  return ["closed", null];
}

// ---------------------------------------------------------------- catalog matching
export function norm(s: unknown): string {
  let out = String(s ?? "").toLowerCase();
  out = out.replace(/https?:\/\/\S+/g, " ");
  out = out.replace(/\[[^\]]*\]/g, " "); // [button: …], [they tapped: …], [replying to your story]
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

/** Normalised prefixes (first 40 chars) of every message this row can send. */
export function fingerprints(res: CatalogRow): string[] {
  const z = res.zernio ?? {};
  const dm = res.dm ?? {};
  const op = res.opener ?? {};
  const cands: unknown[] = [dm.message, z.dm_message, op.message, z.button_title, dm.button];
  cands.push(...(z.dm_message_variations ?? []), ...(op.variations ?? []));
  const out: string[] = [];
  for (const c of cands) {
    const n = norm(c).slice(0, 40);
    if (n.length >= 6 && !out.includes(n)) out.push(n);
  }
  return out;
}

export function urlFragments(res: CatalogRow): string[] {
  const frags: string[] = [...(res.match ?? [])];
  for (const u of [res.resource_url, res.zernio?.button_url]) if (u) frags.push(u);
  const out: string[] = [];
  for (const f of frags) {
    const clean = String(f)
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** Every keyword this row is triggered by, lowercased. */
export function keywordsOf(res: CatalogRow): string[] {
  const kws = new Set<string>();
  for (const t of res.triggers ?? []) if (t.keyword) kws.add(String(t.keyword).toLowerCase());
  if (res.zernio?.keyword) kws.add(String(res.zernio.keyword).toLowerCase());
  return [...kws].sort();
}

/** Which catalog row does one of OUR messages come from? URL fragments
 *  first (strongest), then message fingerprints. */
export function matchOutgoing(text: string | null | undefined, catalog: CatalogRow[]): string | null {
  const low = (text ?? "").toLowerCase();
  for (const res of catalog) if (urlFragments(res).some((f) => low.includes(f))) return res.slug;
  const n = norm(text);
  if (n.length < 6) return null;
  for (const res of catalog) {
    for (const fp of fingerprints(res)) if (n.startsWith(fp) || n.includes(fp)) return res.slug;
  }
  return null;
}

/** {keyword: row} for words that work in a DM: the setter row + dm-surface triggers. */
export function dmKeywordRows(catalog: CatalogRow[]): Map<string, CatalogRow> {
  const out = new Map<string, CatalogRow>();
  for (const r of catalog) {
    if (r.type === "setter") for (const kw of keywordsOf(r)) out.set(kw, r);
    for (const t of r.triggers ?? []) if (t.surface === "dm" && t.keyword) out.set(String(t.keyword).toLowerCase(), r);
  }
  return out;
}

/** A bare keyword or a button title: a trigger, not something they said. */
export function isTriggerText(text: string | null | undefined, catalog: CatalogRow[]): boolean {
  const n = norm(text);
  if (!n) return true;
  for (const res of catalog) {
    if (keywordsOf(res).includes(n)) return true;
    const title = norm(res.zernio?.button_title);
    if (title && n === title) return true;
  }
  return false;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;

export function emailIn(text: string | null | undefined): string | null {
  const m = EMAIL_RE.exec(text ?? "");
  return m ? m[0].toLowerCase() : null;
}

/** A reply that is just an email: the answer to an email gate, not something
 *  to reply to. "sure, sam@x.io, what's next?" is not. */
export function isEmailOnly(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  const e = EMAIL_RE.exec(t);
  if (!e) return false;
  const rest = (t.slice(0, e.index) + t.slice(e.index + e[0].length)).toLowerCase();
  return !rest.replace(/[\s.,!:;'"()-]|its|it's|here|sure|ok|okay|yes|yep/g, "");
}

export function slugsWithTagPrefix(tags: string[] | null | undefined, prefix: string): string[] {
  const out = new Set<string>();
  for (const t of tags ?? []) if (t.startsWith(prefix) && t.slice(prefix.length)) out.add(t.slice(prefix.length));
  return [...out].sort();
}

// ---------------------------------------------------------------- entry
/** How this person arrived. Decided once, from the first messages. */
export function entryOf(msgs: ThreadMessage[], _tags: string[], catalog: CatalogRow[]): Entry {
  const firstIn = msgs.find((m) => m.incoming);
  const firstOut = msgs.find((m) => !m.incoming);
  const at = (firstIn ?? firstOut)?.at ?? null;
  const entry: Entry = { via: "unknown", slug: null, keyword: null, at };

  const setterRows = catalog.filter((r) => r.type === "setter");
  const inBeforeOut = firstIn && (!firstOut || (firstIn.at ?? "") <= (firstOut.at ?? ""));

  if (inBeforeOut && firstIn) {
    const text = norm(firstIn.text);
    for (const r of setterRows) {
      if (keywordsOf(r).includes(text)) return { ...entry, via: "setter_keyword", slug: r.slug, keyword: text };
    }
    if (firstIn.story_reply) {
      let slug = firstOut ? matchOutgoing(firstOut.text, catalog) : null;
      for (const r of catalog) if (keywordsOf(r).includes(text)) slug = r.slug;
      return { ...entry, via: "story_keyword", slug, keyword: text || null };
    }
    for (const r of catalog) {
      if (r.type !== "setter" && keywordsOf(r).includes(text)) return { ...entry, via: "dm_keyword", slug: r.slug, keyword: text };
    }
    return { ...entry, via: "cold_dm" };
  }

  if (firstOut) {
    const slug = matchOutgoing(firstOut.text, catalog);
    if (slug) {
      const row = catalog.find((r) => r.slug === slug);
      if (row?.type === "setter") {
        // Comment → setter (OpenReply sent the opener as the private reply).
        // The entry starts at OUR opener, so their first reply ("yes") counts.
        return { ...entry, via: "setter_comment", slug, at: firstOut.at };
      }
      return { ...entry, via: "post_keyword", slug };
    }
    return { ...entry, via: "we_opened" };
  }
  return entry;
}

// ---------------------------------------------------------------- observe
export function newRecord(cid: string, handle = "", contactId: string | null = null, name = ""): SetterRecord {
  return {
    cid,
    handle,
    contact_id: contactId,
    name,
    state: "new",
    stage: null,
    entry: null,
    resources_sent: [],
    clicked: [],
    their_last_at: null,
    our_last_at: null,
    last_incoming_id: null,
    last_incoming_text_id: null,
    delivered_at: null,
    opener_sent_at: null,
    nudges: 0,
    friday_last_at: null,
    window: { state: "closed", until: null },
    next_action: { kind: "none", at: null },
    draft: null,
    proposed_tags: {},
    tags: [],
    history: [],
  };
}

export function logEvent(rec: SetterRecord, now: TimeLike, event: string): void {
  rec.history = [...(rec.history ?? []), { at: iso(parseIso(now)), event }].slice(-60);
}

function clone(rec: SetterRecord): SetterRecord {
  return JSON.parse(JSON.stringify(rec)) as SetterRecord;
}

/** Fold the thread + contact tags into the record. Idempotent. */
export function observe(
  input: SetterRecord,
  msgs: ThreadMessage[],
  tagsIn: string[] | null | undefined,
  catalog: CatalogRow[],
  now: TimeLike,
  // Unused, kept so calls match state_lib.observe(rec, msgs, tags, catalog, now, cfg).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _cfg?: StateConfig
): SetterRecord {
  const rec = clone(input);
  const tags = [...(tagsIn ?? [])];
  rec.tags = tags;
  const incoming = msgs.filter((m) => m.incoming);
  const outgoing = msgs.filter((m) => !m.incoming);

  if (incoming.length) {
    const last = incoming[incoming.length - 1];
    rec.their_last_at = last.at || rec.their_last_at;
    rec.last_incoming_id = last.id;
    const said = incoming.filter((m) => !m.postback && !isTriggerText(m.text, catalog) && !isEmailOnly(m.text));
    const emails = incoming.map((m) => emailIn(m.text)).filter((e): e is string => Boolean(e));
    if (emails.length) rec.email = emails[emails.length - 1];
    rec.last_incoming_text_id = said.length ? said[said.length - 1].id : null;
    rec.last_incoming_text_at = said.length ? said[said.length - 1].at : null;
  }
  if (outgoing.length) rec.our_last_at = outgoing[outgoing.length - 1].at || rec.our_last_at;

  if (!rec.entry || rec.entry.via == null || rec.entry.via === "unknown") rec.entry = entryOf(msgs, tags, catalog);

  // Re-entry: someone who wrote "hey" last month and DMs the setter word today
  // starts over on the keyword path. Only a LATER keyword message counts.
  const kwRows = dmKeywordRows(catalog);
  let entryAt = rec.entry?.at ?? "";
  for (const m of incoming) {
    const word = norm(m.text);
    const cur: Entry | null = rec.entry;
    const later = (m.at ?? "") > entryAt;
    const same = cur?.keyword === word && cur?.at === m.at;
    const row = kwRows.get(word);
    if (!row || !later || same) continue;
    const via: EntryVia = row.type === "setter" ? "setter_keyword" : "dm_keyword";
    logEvent(rec, m.at || now, `re-entry:${via}:${word}`);
    rec.entry = { via, slug: row.slug, keyword: word, at: m.at };
    rec.delivered_at = null;
    rec.opener_sent_at = null;
    rec.nudges = 0;
    entryAt = m.at || entryAt;
    if (rec.state === "not_now" || rec.state === "unreachable") rec.state = "new";
  }

  // Re-entry via a comment: an old thread where OpenReply has just sent a
  // setter opener again (they commented the keyword) starts over on that path.
  const commentSetters = new Set(
    catalog
      .filter((r) => r.type === "setter" && (r.triggers ?? []).some((t) => t.surface === "comment"))
      .map((r) => r.slug)
  );
  for (const m of outgoing) {
    if ((m.at ?? "") <= (rec.entry?.at ?? "")) continue;
    const slug = matchOutgoing(m.text, catalog);
    if (!slug || !commentSetters.has(slug)) continue;
    logEvent(rec, m.at || now, `re-entry:setter_comment:${slug}`);
    rec.entry = { via: "setter_comment", slug, keyword: null, at: m.at };
    rec.delivered_at = null;
    rec.opener_sent_at = null;
    rec.nudges = 0;
    if (rec.state === "not_now" || rec.state === "unreachable") rec.state = "new";
  }

  // resources: what we actually sent (thread) ∪ what Zernio says we sent (tags)
  const sent = new Set([...(rec.resources_sent ?? []), ...slugsWithTagPrefix(tags, "sent:")]);
  let deliveredAt = rec.delivered_at;
  entryAt = rec.entry?.at ?? "";
  const setterSlugs = new Set(catalog.filter((r) => r.type === "setter").map((r) => r.slug));
  for (const m of outgoing) {
    const slug = matchOutgoing(m.text, catalog);
    if (slug && !setterSlugs.has(slug)) {
      sent.add(slug);
      // a link in the message = the resource was actually delivered
      const row = catalog.find((r) => r.slug === slug);
      const hasLink = row ? urlFragments(row).some((f) => (m.text ?? "").toLowerCase().includes(f)) : false;
      if (hasLink && !deliveredAt && (m.at ?? "") >= entryAt) deliveredAt = m.at;
    }
  }
  rec.resources_sent = [...sent].sort();
  rec.clicked = [...new Set([...(rec.clicked ?? []), ...slugsWithTagPrefix(tags, "clicked:")])].sort();
  if (deliveredAt && !rec.delivered_at) {
    rec.delivered_at = deliveredAt;
    const sorted = [...sent].sort();
    logEvent(rec, deliveredAt, `delivered:${sorted.length ? sorted[sorted.length - 1] : "?"}`);
  }

  // the setter's own first send after delivery (or after the setter keyword)
  if (!rec.opener_sent_at) {
    const base = rec.delivered_at || rec.entry?.at;
    for (const m of outgoing) {
      if (base && (m.at ?? "") > base && !matchOutgoing(m.text, catalog)) {
        rec.opener_sent_at = m.at;
        break;
      }
    }
  }
  return rec;
}

// ---------------------------------------------------------------- advance
function setState(rec: SetterRecord, state: SetterStateName, now: TimeLike): void {
  if (rec.state !== state) {
    logEvent(rec, now, `state:${rec.state}->${state}`);
    rec.state = state;
  }
}

const KEYWORD_VIAS: EntryVia[] = ["setter_keyword", "setter_comment", "dm_keyword", "post_keyword", "story_keyword"];

/** Apply timers. Returns [rec, action]; action is null when nothing is due. */
export function advance(input: SetterRecord, now: TimeLike, cfg?: StateConfig): [SetterRecord, SetterAction | null] {
  const rec = clone(input);
  const t = timers(cfg);
  const nowDt = parseIso(now)!;
  const tags = new Set(rec.tags ?? []);
  const entry: Partial<Entry> = rec.entry ?? {};
  const via = entry.via;

  const [wstate, until] = windowState(rec.their_last_at, nowDt, cfg);
  rec.window = { state: wstate, until };
  rec.next_action = { kind: "none", at: null };

  // hard overrides from tags
  if (FREEZE_TAGS.some((f) => tags.has(f))) {
    setState(rec, "frozen", nowDt);
    return [rec, null];
  }
  if (tags.has("booked")) {
    setState(rec, "booked", nowDt);
    return [rec, null];
  }
  if (tags.has("not_now")) {
    setState(rec, "not_now", nowDt);
    return [rec, null];
  }
  if (tags.has("not_now_auto") && rec.triaged_msg_id === rec.last_incoming_id) {
    setState(rec, "not_now", nowDt); // triage's call, until they say something new
    return [rec, null];
  }

  const theirLast = parseIso(rec.their_last_at);
  const ourLast = parseIso(rec.our_last_at);
  const delivered = parseIso(rec.delivered_at);
  const opener = parseIso(rec.opener_sent_at);
  // "spoke" = said something real SINCE this entry; a "hey" before a later
  // setter keyword doesn't count as answering the opener.
  const textAt = rec.last_incoming_text_at ?? "";
  const theySpoke =
    Boolean(rec.last_incoming_text_id) && (!via || !KEYWORD_VIAS.includes(via) || textAt > (entry.at ?? ""));
  const theySpokeLast = Boolean(theirLast) && (!ourLast || theirLast! > ourLast);

  // 1. they said something real and it is the newest thing -> reply
  const held = (rec.skipped_anchors ?? []).includes(rec.last_incoming_text_id ?? "\u0000");
  if (theySpoke && theySpokeLast && wstate !== "closed" && !held) {
    setState(rec, "in_conversation", nowDt);
    rec.next_action = { kind: "reply", at: iso(nowDt) };
    return [rec, { kind: "reply", anchor: rec.last_incoming_text_id!, human_agent: wstate === "human_agent" }];
  }

  // 2. stale conversation -> not_now
  if (
    theirLast &&
    (rec.state === "in_conversation" || rec.state === "setter_open") &&
    nowDt.getTime() - theirLast.getTime() > t.stale_days * DAY
  ) {
    setState(rec, "not_now", nowDt);
    return [rec, null];
  }

  // 3. setter keyword / setter comment: the opener went out; waiting for them
  if (via === "setter_keyword" && !theySpoke) {
    setState(rec, wstate !== "closed" ? "setter_open" : "not_now", nowDt);
    return [rec, null];
  }
  if (via === "setter_comment" && !theySpoke) {
    // a private reply opens no window until they answer it; it just expires
    const at = parseIso(entry.at);
    if (at && nowDt.getTime() - at.getTime() > t.offer_expires_days * DAY) setState(rec, "unreachable", nowDt);
    else setState(rec, "offered", nowDt);
    return [rec, null];
  }

  // 4. resource paths
  if (via === "post_keyword" || via === "story_keyword" || via === "dm_keyword") {
    if (!delivered) {
      // comment path: private reply sent, no tap yet
      const at = parseIso(entry.at);
      if (wstate === "closed" && at && nowDt.getTime() - at.getTime() > t.offer_expires_days * DAY) {
        setState(rec, "unreachable", nowDt);
      } else if (rec.state === "new" || rec.state === "offered") {
        setState(rec, "offered", nowDt);
      }
      return [rec, null];
    }

    if ((rec.state === "new" || rec.state === "offered") && !opener) setState(rec, "delivered", nowDt);

    if (!opener) {
      const due = new Date(delivered.getTime() + t.value_opener_delay_minutes * MIN);
      if (wstate === "closed") {
        setState(rec, "unreachable", nowDt);
        return [rec, null];
      }
      rec.next_action = { kind: "value_opener", at: iso(due) };
      if (nowDt >= due) {
        return [rec, { kind: "value_opener", anchor: `opener:${rec.delivered_at}`, human_agent: wstate === "human_agent" }];
      }
      return [rec, null];
    }
  }

  // 5. we spoke last (opener or any reply) and they went quiet -> one nudge
  if (ourLast && (!theirLast || ourLast > theirLast)) {
    if ((rec.nudges ?? 0) >= t.nudge_max) {
      if (theirLast && nowDt.getTime() - theirLast.getTime() > t.stale_days * DAY) setState(rec, "not_now", nowDt);
      return [rec, null];
    }
    const due = new Date(ourLast.getTime() + t.nudge_after_hours * HOUR);
    if (wstate === "closed") {
      setState(rec, !theySpoke ? "unreachable" : "not_now", nowDt);
      return [rec, null];
    }
    rec.next_action = { kind: "nudge", at: iso(due) };
    if (nowDt >= due) {
      return [rec, { kind: "nudge", anchor: `nudge:${rec.our_last_at}`, human_agent: wstate === "human_agent" }];
    }
    return [rec, null];
  }

  return [rec, null];
}

// ---------------------------------------------------------------- sends (from setter_local.py)
/** What setter_local._record_send does after Kevin approves a draft. */
export function recordSend(
  input: SetterRecord,
  kind: string,
  bubbles: string[],
  edited: boolean,
  humanAgent: boolean,
  now: TimeLike
): SetterRecord {
  const rec = clone(input);
  const ts = iso(parseIso(now))!;
  const first = !(rec.sends ?? []).length && !rec.our_last_at;
  rec.our_last_at = ts;
  if (kind === "value_opener") rec.opener_sent_at = ts;
  if (kind === "nudge") rec.nudges = (rec.nudges ?? 0) + 1;
  if (kind === "invite") rec.invited = { route: "call", offer: rec.draft?.offer ?? null, at: ts };
  if (rec.draft?.stage) rec.stage = rec.draft.stage;
  rec.sends = [...(rec.sends ?? []), { at: ts, kind, edited, human_agent: humanAgent, bubbles, first }].slice(-50);
  rec.draft = null;
  logEvent(rec, ts, `sent:${kind}${edited ? " edited" : ""}${humanAgent ? " human_agent" : ""}`);
  return rec;
}

/** Skip / hold: remember the anchor so it isn't re-drafted until they write again. */
export function recordSkip(input: SetterRecord, anchor: string, event: string, now: TimeLike): SetterRecord {
  const rec = clone(input);
  rec.skipped_anchors = [...(rec.skipped_anchors ?? []), anchor].slice(-100);
  rec.draft = null;
  logEvent(rec, now, event);
  return rec;
}

// ---------------------------------------------------------------- projection
/** The flat fields a view shows. */
export function projection(rec: SetterRecord): Record<string, string | number | string[] | null> {
  const entry = rec.entry;
  return {
    type: "dm-person",
    handle: rec.handle || "",
    name: rec.name || "",
    cid: rec.cid,
    state: rec.state,
    stage: rec.stage,
    via: entry?.via ?? null,
    resource: entry?.slug ?? null,
    keyword: entry?.keyword ?? null,
    window: rec.window?.state ?? null,
    window_until: rec.window?.until ?? null,
    next_action: rec.next_action?.kind ?? null,
    next_action_at: rec.next_action?.at ?? null,
    draft_status: rec.draft ? "ready" : "none",
    draft_kind: rec.draft?.kind ?? null,
    invite_offer: rec.draft?.offer ?? null,
    invited: rec.invited?.route ?? null,
    their_last_at: rec.their_last_at,
    resources_sent: rec.resources_sent ?? [],
    clicked: rec.clicked ?? [],
    tags: rec.tags ?? [],
    nudges: rec.nudges ?? 0,
  };
}
