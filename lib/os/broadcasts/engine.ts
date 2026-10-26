// The one-off broadcast engine (dm-crm slice 5). A broadcast is built in five
// steps on one screen and sent once:
//   1. Start: Now (until an end time today) or Window (date, start, end).
//   2. Who: one managed tag (or a fixed list), minus archived, spam, paused,
//      Personal, Pitches, busy in a workflow, outside the 24h window; the link
//      guard leaves out anyone already sent one of its links.
//   3. Messages: text bubbles ({first_name}) and link bubbles (a resource or
//      a pasted link), each its own bubble; an optional follow-up.
//   4. Personalise: the agent J writes as, and per person / 5 variations /
//      as written. Make drafts runs in the background.
//   5. Review: approve, edit, skip, Send myself; Send (Now) or Schedule
//      (Window) spaces approved ones at random inside the window, each
//      person's 24h window and the daily cap (schedule.ts, send.ts).
// Status: draft → drafting → in_review → scheduled → sending → sent; cancel
// from any of them before sent. Nothing sends without Approve and Send.

import { selectAudience, excludedCode, excludedReason, type AudienceEntry } from "@/lib/os/broadcasts/audience";
import { enqueueBroadcastSend } from "@/lib/os/broadcasts/jobs";
import {
  alreadyHadLink,
  asWritten,
  bubbleLinks,
  capFigures,
  datedName,
  dayLabel,
  defaultNowEnd,
  duplicateDate,
  EXTEND_LIMIT,
  fromVariation,
  hasEmptyLink,
  linksIn,
  linksOf,
  nowEndError,
  perPerson,
  plannedOf,
  sendWindow,
  slugFor,
  spreadEvenly,
  startLabel,
  textOf,
  windowError,
  type CapFigures,
} from "@/lib/os/broadcasts/oneoff";
import { isNearDuplicateOfAny, messageText, personaliseOne, threadState, writeVariations, type DraftWriter } from "@/lib/os/broadcasts/personalise";
import { assignSchedule, seededRng, validTime } from "@/lib/os/broadcasts/schedule";
import { broadcastStore, type BroadcastPatch, type BroadcastStore } from "@/lib/os/broadcasts/store";
import { firstNameOf, shortLink, splitLines, stripLinks } from "@/lib/os/broadcasts/template";
import {
  NOT_SENT_REASONS,
  SKIP_LABEL,
  VARIATION_COUNT,
  type BroadcastBubble,
  type BroadcastContact,
  type BroadcastMessageView,
  type BroadcastRunView,
  type BroadcastStatus,
  type BroadcastView,
  type PersonaliseMode,
  type SkipReason,
} from "@/lib/os/broadcasts/types";
import { capState, localDate } from "@/lib/os/sending/cap";
import { getSetterConfig } from "@/lib/os/setter/config";

export interface EngineDeps {
  store?: BroadcastStore;
  now?: Date;
  /** J for one contact, writing as `setterId`; null = the deterministic writer. */
  writerFor?: (workspaceId: string, contactId: string, setterId: string | null) => Promise<DraftWriter | null>;
  /** J for the 5 variations, writing as `setterId`; null = the deterministic 5. */
  variationsWriter?: (workspaceId: string, setterId: string | null) => Promise<DraftWriter | null>;
  /** Pause all + cap; defaults read OsWorkspace / OsEvent. */
  cap?: (workspaceId: string, now: Date) => Promise<{ sentToday: number; cap: number; pausedAll: boolean }>;
  enqueue?: typeof enqueueBroadcastSend;
  /** The last lines of a thread for J; defaults to the setter store. */
  recent?: (workspaceId: string, contactId: string) => Promise<string[]>;
  /** Runs Make drafts after the action returns. Tests pass one that awaits. */
  background?: (task: () => Promise<void>) => void | Promise<void>;
  /** The workspace timezone for new broadcasts. */
  timezone?: (workspaceId: string) => Promise<string>;
  /** Tag id → name (managed tags). */
  tagName?: (workspaceId: string, tagId: string) => Promise<string | null>;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; confirm?: string };

function ctx(d: EngineDeps) {
  return {
    store: d.store ?? broadcastStore(),
    now: d.now ?? new Date(),
    writerFor: d.writerFor ?? defaultWriterFor,
    variationsWriter: d.variationsWriter ?? defaultVariationsWriter,
    cap: d.cap ?? (async (w: string, now: Date) => capState(w, { now })),
    enqueue: d.enqueue ?? enqueueBroadcastSend,
    recent: d.recent ?? recentLines,
    background:
      d.background ??
      ((task: () => Promise<void>) => {
        void task().catch((err) => console.error("[OS Broadcasts] drafting failed:", err));
      }),
    timezone: d.timezone ?? defaultTimezone,
    tagName: d.tagName ?? defaultTagName,
  };
}
type Ctx = ReturnType<typeof ctx>;

async function defaultTimezone(workspaceId: string): Promise<string> {
  try {
    const { getWorkspaceSettings } = await import("@/lib/os/workspace-settings");
    return (await getWorkspaceSettings(workspaceId)).timezone;
  } catch {
    return "Europe/Luxembourg";
  }
}

async function defaultTagName(workspaceId: string, tagId: string): Promise<string | null> {
  const { listTags } = await import("@/lib/os/tags/store");
  return (await listTags(workspaceId)).find((t) => t.id === tagId)?.name ?? null;
}

/** J's system prompt for a setter (the broadcast's agent, else the contact's).
 *  Null (the deterministic writer) when the drafter is the fake, and always in
 *  OS_MOCK: the sample never calls a model. */
async function jWriter(workspaceId: string, setterId: string | null, contactId: string | null): Promise<DraftWriter | null> {
  const cfg = getSetterConfig();
  if (cfg.drafter.backend === "fake") return null;
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) return null;
  try {
    const [{ setterStore }, { dbKnowledge, defaultSetterId }, { loadMethod }, { systemPrompt }, { draft }] = await Promise.all([
      import("@/lib/os/setter/store"),
      import("@/lib/os/setter/setters"),
      import("@/lib/os/setter/knowledge"),
      import("@/lib/os/setter/prompt"),
      import("@/lib/os/setter/drafter"),
    ]);
    let setter = setterId ? await dbKnowledge.forSetter(workspaceId, setterId) : null;
    if (!setter && contactId) {
      const contact = await setterStore().getContact(contactId, workspaceId);
      if (contact) setter = await dbKnowledge.forContact(contact);
    }
    if (!setter) {
      const id = await defaultSetterId(workspaceId);
      setter = id ? await dbKnowledge.forSetter(workspaceId, id) : null;
    }
    if (!setter) return null;
    const system = systemPrompt(loadMethod(), setter.profile, setter.offered, new Date().toISOString().slice(0, 10));
    return async (prompt) => (await draft({ system, prompt, job: "draft", settings: cfg.drafter })).obj;
  } catch (err) {
    console.error("[OS Broadcasts] J unavailable, using the template:", err instanceof Error ? err.message : err);
    return null;
  }
}

const defaultWriterFor = (workspaceId: string, contactId: string, setterId: string | null) => jWriter(workspaceId, setterId, contactId);
const defaultVariationsWriter = (workspaceId: string, setterId: string | null) => jWriter(workspaceId, setterId, null);

/** The last lines of their thread for J ("THEM: …", "US: …"). */
async function recentLines(workspaceId: string, contactId: string): Promise<string[]> {
  try {
    const { setterStore } = await import("@/lib/os/setter/store");
    const s = setterStore();
    const contact = await s.getContact(contactId, workspaceId);
    if (!contact) return [];
    const msgs = await s.readThread(contact);
    return msgs.slice(-8).map((m) => `${m.incoming ? "THEM" : "US"}: ${m.text.replace(/\s+/g, " ").slice(0, 240)}`);
  } catch {
    return [];
  }
}

function handleOf(c: Pick<BroadcastContact, "username" | "fullName" | "contactId">): string {
  return c.username ?? c.fullName ?? c.contactId;
}

/** The latest of their last message and the inbound stamp. */
function lastInbound(c: BroadcastContact): number {
  return Math.max(c.theirLastAt ? Date.parse(c.theirLastAt) : 0, c.lastInboundAt ? Date.parse(c.lastInboundAt) : 0);
}

// ---------------------------------------------------------------- Who

export const ALREADY_HAD_LINK = "already_had_link";

export interface WhoResult {
  /** The tag's name ("" for a fixed list). */
  tag: string;
  /** Tagged (or on the list). */
  total: number;
  /** In the send: eligible and not caught by the link guard. */
  get: AudienceEntry[];
  /** Eligible but already had one of the links (drafted, collapsed). */
  hadLink: { entry: AudienceEntry; at: string }[];
  /** Left out, with why. */
  leftOut: { contact: BroadcastContact; reason: string }[];
  /** "Get it 45", "Already had this link 3", ... */
  rows: { label: string; n: number; main: boolean }[];
}

async function tagNameOf(c: Ctx, workspaceId: string, b: BroadcastView): Promise<string> {
  if (!b.audienceTagId) return "";
  return b.audienceTag || ((await c.tagName(workspaceId, b.audienceTagId).catch(() => null)) ?? "");
}

async function audienceContacts(c: Ctx, workspaceId: string, b: BroadcastView): Promise<{ tag: string; contacts: BroadcastContact[] }> {
  if (!b.audienceTagId) return { tag: "", contacts: b.contactIds.length ? await c.store.contactsByIds(workspaceId, b.contactIds) : [] };
  const tag = await tagNameOf(c, workspaceId, b);
  return { tag, contacts: tag ? await c.store.taggedContacts(workspaceId, tag) : [] };
}

const REASON_LABEL: Record<string, string> = {
  "Never wrote to you": "Outside Instagram's 24-hour window",
  "Last wrote over 24h before the send": "Outside Instagram's 24-hour window",
  Personal: "Marked Personal",
  Pitches: "Pitches",
  Paused: "Paused",
  Archived: "Archived",
  Spam: "Spam",
  "In a workflow": "In a workflow",
  "Pause all is on": "Pause all is on",
};

/** Who gets it, who's left out and why. The 24h window is read at the start of the send (or now, if later). */
async function whoFor(c: Ctx, workspaceId: string, b: BroadcastView, opts: { pausedAll?: boolean } = {}): Promise<WhoResult> {
  const { tag, contacts } = await audienceContacts(c, workspaceId, b);
  const w = sendWindow(b, c.now);
  const from = new Date(Math.max(w.start.getTime(), c.now.getTime()));
  const until = new Date(Math.max(w.end.getTime(), from.getTime() + 60_000));
  const result = selectAudience(contacts, { tag, from, until, pausedAll: opts.pausedAll, cfg: getSetterConfig() });
  const links = bubbleLinks(b.bubbles);
  const had = links.length ? alreadyHadLink(links, await c.store.sentTraces(workspaceId, b.id)) : new Map<string, string>();
  const get = result.eligible.filter((e) => !had.has(e.contact.contactId));
  const hadLink = result.eligible.filter((e) => had.has(e.contact.contactId)).map((entry) => ({ entry, at: had.get(entry.contact.contactId) ?? "" }));
  const leftOut = [...result.outside, ...result.excluded].map((e) => ({ contact: e.contact, reason: e.reason ?? "Left out" }));
  const counts = new Map<string, number>();
  for (const l of leftOut) {
    const label = REASON_LABEL[l.reason] ?? l.reason;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const total = result.eligible.length + result.outside.length + result.excluded.length;
  return {
    tag,
    total,
    get,
    hadLink,
    leftOut,
    rows: [
      { label: "Get it", n: get.length, main: true },
      ...(hadLink.length ? [{ label: "Already had this link", n: hadLink.length, main: false }] : []),
      ...[...counts.entries()].sort((a, z) => z[1] - a[1]).map(([label, n]) => ({ label, n, main: false })),
    ],
  };
}

/** Who step: who gets it and who's left out (and why). */
export async function audienceOf(workspaceId: string, b: BroadcastView, deps: EngineDeps = {}): Promise<WhoResult> {
  return whoFor(ctx(deps), workspaceId, b);
}

// ---------------------------------------------------------------- create, edit, duplicate

async function uniqueKey(c: Ctx, workspaceId: string, name: string): Promise<string> {
  const keys = new Set((await c.store.list(workspaceId)).map((b) => b.key));
  return slugFor(name, (k) => keys.has(k));
}

/** "New broadcast": a draft, Now until the default end, in the workspace timezone. */
export async function createBroadcast(workspaceId: string, deps: EngineDeps = {}): Promise<Result<{ key: string }>> {
  const c = ctx(deps);
  const tz = await c.timezone(workspaceId);
  const name = "New broadcast";
  const b = await c.store.create(workspaceId, {
    key: await uniqueKey(c, workspaceId, name),
    name,
    status: "draft",
    startMode: "now",
    windowStart: "10:00",
    windowEnd: defaultNowEnd(c.now, tz),
    timezone: tz,
    bubbles: [{ type: "text", text: "" }],
  });
  return { ok: true, key: b.key };
}

export interface StepsInput {
  name?: string;
  startMode?: "now" | "window";
  sendDate?: string | null;
  windowStart?: string;
  windowEnd?: string;
  audienceTagId?: string | null;
  bubbles?: BroadcastBubble[];
  followupTemplate?: string | null;
  followupDelayMin?: number;
  personaliseMode?: PersonaliseMode;
  variations?: string[][];
  setterId?: string | null;
}

/** Check and clean the builder's input. */
export function validateSteps(i: StepsInput, b: BroadcastView): { patch: BroadcastPatch } | { error: string } {
  const patch: BroadcastPatch = {};
  if (i.name !== undefined) {
    const n = String(i.name).trim();
    if (!n) return { error: "Give it a name." };
    patch.name = n.slice(0, 120);
  }
  if (i.startMode !== undefined) patch.startMode = i.startMode === "now" ? "now" : "window";
  if (i.sendDate !== undefined) {
    if (i.sendDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(i.sendDate)) return { error: "Pick a date." };
    patch.sendDate = i.sendDate;
  }
  for (const k of ["windowStart", "windowEnd"] as const) {
    if (i[k] === undefined) continue;
    const v = String(i[k]).padStart(5, "0");
    if (!validTime(v)) return { error: "Times look wrong (HH:MM)." };
    patch[k] = v;
  }
  const mode = patch.startMode ?? b.startMode;
  if (mode === "window" && (patch.windowStart ?? b.windowStart) >= (patch.windowEnd ?? b.windowEnd)) return { error: "The window has to end after it starts." };
  if (mode === "now" && patch.startMode === "now" && i.sendDate === undefined) patch.sendDate = null;
  if (i.audienceTagId !== undefined) {
    patch.audienceTagId = i.audienceTagId || null;
    if (patch.audienceTagId) patch.contactIds = [];
  }
  if (i.bubbles !== undefined) {
    const out: BroadcastBubble[] = [];
    for (const x of i.bubbles.slice(0, 20)) {
      if (x.type === "text") out.push({ type: "text", text: String(x.text ?? "").slice(0, 1000) });
      else {
        const url = x.url ? cleanUrl(x.url) : null;
        if (x.url && !url) return { error: "That link doesn't look right. Paste the full URL." };
        out.push({ type: "link", url, resourceId: x.resourceId ?? null, label: x.label ?? null });
      }
    }
    patch.bubbles = out;
  }
  if (i.followupTemplate !== undefined) patch.followupTemplate = i.followupTemplate?.trim() ? i.followupTemplate.trim().slice(0, 500) : null;
  if (i.followupDelayMin !== undefined) {
    const n = Math.round(Number(i.followupDelayMin));
    if (!Number.isFinite(n) || n < 1 || n > 240) return { error: "Pick a follow-up delay between 1 and 240 minutes." };
    patch.followupDelayMin = n;
  }
  if (i.personaliseMode !== undefined) {
    if (!["per_person", "variations", "as_written"].includes(i.personaliseMode)) return { error: "Pick how J personalises." };
    patch.personaliseMode = i.personaliseMode;
  }
  if (i.variations !== undefined) patch.variations = i.variations.slice(0, VARIATION_COUNT).map((v) => v.map((t) => stripLinks(String(t)).slice(0, 1000)).filter(Boolean));
  if (i.setterId !== undefined) patch.setterId = i.setterId || null;
  return { patch };
}

function cleanUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.includes(".") ? u.toString() : null;
  } catch {
    return null;
  }
}

const same = (a: unknown, z: unknown) => JSON.stringify(a ?? null) === JSON.stringify(z ?? null);

/** Does this patch change Who, Messages or Personalise (which remakes drafts)? */
function remakes(patch: BroadcastPatch, b: BroadcastView): boolean {
  const keys = ["audienceTagId", "contactIds", "bubbles", "followupTemplate", "followupDelayMin", "personaliseMode", "variations", "setterId"] as const;
  return keys.some((k) => patch[k] !== undefined && !same(patch[k], b[k]));
}

/**
 * Save the builder's steps. Before Send only. With drafts made, a change to
 * Who, Messages or Personalise asks first ("This remakes all N drafts…") and
 * remakes them on confirm; Start never remakes.
 */
export async function saveSteps(workspaceId: string, key: string, input: StepsInput, opts: { confirm?: boolean } = {}, deps: EngineDeps = {}): Promise<Result<{ remade: boolean }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  const v = validateSteps(input, b);
  if ("error" in v) return { ok: false, error: v.error };
  const editable = b.status === "draft" || b.status === "in_review" || b.status === "cancelled";
  const onlyName = Object.keys(v.patch).every((k) => k === "name");
  if (!editable && !onlyName) return { ok: false, error: b.status === "drafting" ? "J is drafting. Wait, or cancel first." : "Already sending. Cancel it first." };
  const run = await c.store.runOf(b.id);
  const drafts = run ? (await c.store.messages(run.id)).filter((m) => m.status !== "sent" && m.status !== "skipped" && m.status !== "outside_window").length : 0;
  const remake = b.status === "in_review" && drafts > 0 && remakes(v.patch, b);
  if (remake && !opts.confirm) return { ok: false, error: "", confirm: `This remakes all ${drafts} drafts. Your edits and approvals are lost.` };
  await c.store.update(workspaceId, b.id, v.patch);
  if (remake) {
    const r = await makeDrafts(workspaceId, key, deps);
    if (!r.ok) return r;
  }
  return { ok: true, remade: remake };
}

/** Duplicate: same tag (or list), messages with links cleared, mode and variations, agent, timezone, start mode and window times. */
export async function duplicateBroadcast(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ key: string }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  const date = b.startMode === "now" ? null : duplicateDate(b, c.now);
  const name = datedName(b.name, date, b.timezone);
  const copy = await c.store.create(workspaceId, {
    key: await uniqueKey(c, workspaceId, date ? `${name.replace(/\s*·.*$/, "")}-${date}` : name),
    name,
    audienceTagId: b.audienceTagId,
    contactIds: b.audienceTagId ? [] : [...b.contactIds],
    status: "draft",
    startMode: b.startMode,
    sendDate: date,
    bubbles: b.bubbles.map((x) => (x.type === "link" ? { type: "link" as const, url: null, resourceId: null, label: null } : { ...x })),
    personaliseMode: b.personaliseMode,
    variations: b.variations.map((v) => [...v]),
    duplicatedFromId: b.id,
    followupTemplate: b.followupTemplate,
    followupDelayMin: b.followupDelayMin,
    windowStart: b.windowStart,
    windowEnd: b.windowEnd,
    timezone: b.timezone,
    setterId: b.setterId,
  });
  return { ok: true, key: copy.key };
}

// ---------------------------------------------------------------- drafting

/** Make drafts: refused while a link bubble is empty or nobody gets it; runs in the background. */
export async function makeDrafts(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ total: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  if (b.status !== "draft" && b.status !== "in_review" && b.status !== "cancelled") return { ok: false, error: "Already started." };
  if (hasEmptyLink(b.bubbles)) return { ok: false, error: "Pick a resource or paste a link first." };
  if (!textOf(b.bubbles).length && !linksOf(b.bubbles).length) return { ok: false, error: "Write a message first." };
  if (!b.audienceTagId && !b.contactIds.length) return { ok: false, error: "Pick who gets it." };
  const who = await whoFor(c, workspaceId, b);
  const people = [...who.get.map((e) => ({ e, had: false })), ...who.hadLink.map((h) => ({ e: h.entry, had: true }))];
  if (!who.total) return { ok: false, error: "No one has this tag." };
  if (!people.length) return { ok: false, error: "No one to send to right now." };

  const date = sendWindow(b, c.now).date;
  const run = (await c.store.runOf(b.id)) ?? (await c.store.createRun(b.id, date));
  await c.store.updateRun(run.id, { status: "drafting", createdAt: c.now.toISOString() });
  // People no longer in the send: their old drafts go.
  const keep = new Set(people.map((p) => p.e.contact.contactId));
  for (const m of await c.store.messages(run.id)) {
    if (!keep.has(m.contactId) && m.status !== "sent") await c.store.updateMessage(m.id, { status: "skipped", error: "Not in Who any more", skipReason: null, bubbles: [], followupBubbles: [] });
  }
  let variations = b.variations;
  if (b.personaliseMode === "variations" && variations.filter((v) => v.length).length < VARIATION_COUNT) {
    variations = await writeVariations(textOf(b.bubbles), b.name, await c.variationsWriter(workspaceId, b.setterId), VARIATION_COUNT);
    await c.store.update(workspaceId, b.id, { variations });
  }
  await c.store.update(workspaceId, b.id, { status: "drafting" });
  const fresh = { ...b, variations, status: "drafting" as BroadcastStatus };
  await c.background(() => draftPeople(workspaceId, fresh, { ...run, status: "drafting" }, people, deps));
  return { ok: true, total: people.length };
}

/** Draft each person (in order), stopping if the broadcast is cancelled; then In review. */
async function draftPeople(workspaceId: string, b: BroadcastView, run: BroadcastRunView, people: { e: AudienceEntry; had: boolean }[], deps: EngineDeps, opts: { finalStatus?: BroadcastStatus } = {}) {
  const c = ctx(deps);
  const spread = spreadEvenly(
    people.map((p) => p.e.contact.contactId),
    Math.max(1, b.variations.length),
    seededRng(`${b.id}:spread`)
  );
  const taken: string[] = [];
  let k = 0;
  for (const p of people) {
    const cur = await c.store.getById(b.id);
    if (!cur || cur.status === "cancelled") return;
    await draftOne(c, workspaceId, b, run, p.e.contact, { had: p.had, variation: spread.get(p.e.contact.contactId) ?? 0, taken, seed: k++ });
  }
  const cur = await c.store.getById(b.id);
  if (!cur || cur.status === "cancelled") return;
  await c.store.updateRun(run.id, { status: "review" });
  await c.store.update(workspaceId, b.id, { status: opts.finalStatus ?? "in_review" });
}

/** One person's draft, by the broadcast's mode. A failure is kept as "couldn't draft" with Retry. */
async function draftOne(
  c: Ctx,
  workspaceId: string,
  b: BroadcastView,
  run: BroadcastRunView,
  contact: BroadcastContact,
  o: { had: boolean; variation: number; taken: string[]; seed: number }
): Promise<BroadcastMessageView> {
  const first = firstNameOf(contact.fullName, contact.username);
  const fill = (t: string) => t.replace(/\{first_name\}/gi, first).trim();
  const followFill = b.followupTemplate ? splitLines(fill(b.followupTemplate)) : [];
  const base = { edited: false, scheduledAt: null, error: null, leftOutReason: o.had ? ALREADY_HAD_LINK : null, includedAnyway: false, skipReason: null, sentAt: null };
  try {
    let bubbles: string[];
    let followupBubbles = followFill;
    let reasoning: string | null = null;
    if (b.personaliseMode === "as_written") {
      bubbles = asWritten(b.bubbles, contact);
      reasoning = "As written";
    } else if (b.personaliseMode === "variations") {
      const v = b.variations[o.variation] ?? textOf(b.bubbles);
      bubbles = fromVariation(b.bubbles, v, contact);
      reasoning = `Variation ${o.variation + 1}`;
    } else {
      const at = new Date(Math.max(sendWindow(b, c.now).start.getTime(), c.now.getTime()));
      const write = await c.writerFor(workspaceId, contact.contactId, b.setterId);
      const msg = await personaliseOne(
        {
          contact,
          template: textOf(b.bubbles).join("\n"),
          followupTemplate: b.followupTemplate,
          link: "",
          at,
          recent: await c.recent(workspaceId, contact.contactId),
          avoid: o.taken.slice(-12),
          name: b.name,
        },
        o.taken,
        write,
        o.seed
      );
      bubbles = [...msg.bubbles, ...linksOf(b.bubbles)];
      followupBubbles = msg.followupBubbles;
      reasoning = `${msg.state.label}${msg.reasoning ? ` · ${msg.reasoning}` : ""}`;
      o.taken.push(messageText(msg.bubbles, msg.followupBubbles));
    }
    if (!bubbles.length) throw new Error("Nothing to send.");
    return await c.store.upsertMessage(run.id, workspaceId, contact.contactId, { ...base, bubbles, followupBubbles, status: "drafted", reasoning });
  } catch (err) {
    return await c.store.upsertMessage(run.id, workspaceId, contact.contactId, {
      ...base,
      bubbles: [],
      followupBubbles: [],
      status: "draft_failed",
      error: `Couldn't draft: ${err instanceof Error ? err.message : "J didn't answer"}`,
    });
  }
}

async function messageIn(c: Ctx, workspaceId: string, messageId: string) {
  const m = await c.store.getMessage(messageId);
  if (!m || m.workspaceId !== workspaceId) return null;
  const run = await c.store.getRunById(m.runId);
  if (!run) return null;
  const b = await c.store.getById(run.broadcastId);
  if (!b || b.workspaceId !== workspaceId) return null;
  return { m, run, b };
}

/** Retry a failed draft, or write one draft again (Regenerate). */
export async function redraftOne(workspaceId: string, messageId: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  const { m, run, b } = found;
  if (b.status !== "in_review") return { ok: false, error: "Only while in review." };
  if (m.status !== "drafted" && m.status !== "draft_failed") return { ok: false, error: "Undo the approval first." };
  const contact = await c.store.contact(workspaceId, m.contactId);
  if (!contact) return { ok: false, error: "That contact is gone." };
  const others = (await c.store.messages(run.id)).filter((x) => x.id !== m.id && x.bubbles.length).map((x) => messageText(textOnly(x.bubbles), x.followupBubbles));
  const ids = (await c.store.messages(run.id)).map((x) => x.contactId);
  const spread = spreadEvenly(ids, Math.max(1, b.variations.length), seededRng(`${b.id}:spread`));
  const r = await draftOne(c, workspaceId, b, run, contact, { had: Boolean(m.leftOutReason), variation: spread.get(m.contactId) ?? 0, taken: others, seed: 7 + others.length });
  if (m.includedAnyway) await c.store.updateMessage(r.id, { includedAnyway: true });
  return r.status === "draft_failed" ? { ok: false, error: r.error ?? "Couldn't draft." } : { ok: true };
}

const URL_ONLY = /^https?:\/\/\S+$/i;
const textOnly = (bubbles: string[]) => bubbles.filter((x) => !URL_ONLY.test(x.trim()));

// ---------------------------------------------------------------- review

/** Kevin's words: one bubble per line; the links stay as their own bubbles. */
export async function editMessage(workspaceId: string, messageId: string, input: { text?: string; followup?: string }, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  const { m, run, b } = found;
  if (b.status !== "in_review") return { ok: false, error: "Only while in review." };
  if (m.status === "sent") return { ok: false, error: "Already sent." };
  const links = m.bubbles.filter((x) => URL_ONLY.test(x.trim()));
  const text = input.text !== undefined ? splitLines(input.text).map(stripLinks).filter(Boolean) : textOnly(m.bubbles);
  if (!text.length && !links.length) return { ok: false, error: "Write something, or skip them." };
  const followup = input.followup !== undefined ? splitLines(input.followup) : m.followupBubbles;
  if (b.personaliseMode === "per_person") {
    const others = (await c.store.messages(run.id))
      .filter((x) => x.id !== m.id && x.status !== "skipped" && x.status !== "outside_window" && x.bubbles.length)
      .map((x) => messageText(textOnly(x.bubbles), x.followupBubbles));
    if (isNearDuplicateOfAny(messageText(text, followup), others)) return { ok: false, error: "Too close to another message in this send. Change a few words." };
  }
  await c.store.updateMessage(m.id, { bubbles: [...text, ...links], followupBubbles: followup, edited: true, status: "drafted", error: null });
  return { ok: true };
}

function collapsed(m: Pick<BroadcastMessageView, "leftOutReason" | "includedAnyway">): boolean {
  return Boolean(m.leftOutReason) && !m.includedAnyway;
}

export async function approveMessage(workspaceId: string, messageId: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  if (found.b.status !== "in_review") return { ok: false, error: "Only while in review." };
  if (found.m.status !== "drafted") return { ok: false, error: "Only a draft can be approved." };
  if (!found.m.bubbles.length) return { ok: false, error: "Nothing to send." };
  if (collapsed(found.m)) return { ok: false, error: "They already had this link. Include them first." };
  await c.store.updateMessage(found.m.id, { status: "approved", error: null });
  return { ok: true };
}

/** Approve every draft that's ready (not the collapsed link-guard ones). */
export async function approveAll(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ approved: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  if (b.status !== "in_review") return { ok: false, error: "Only while in review." };
  const run = await c.store.runOf(b.id);
  let approved = 0;
  for (const m of run ? await c.store.messages(run.id) : []) {
    if (m.status !== "drafted" || !m.bubbles.length || collapsed(m)) continue;
    await c.store.updateMessage(m.id, { status: "approved", error: null });
    approved++;
  }
  return { ok: true, approved };
}

/** Back to a draft (undo approve). */
export async function unapproveMessage(workspaceId: string, messageId: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  if (found.m.status !== "approved") return { ok: false, error: "Nothing to undo." };
  await c.store.updateMessage(found.m.id, { status: "drafted" });
  return { ok: true };
}

/** Skip / put back. */
export async function skipMessage(workspaceId: string, messageId: string, skip: boolean, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That message is gone. Refresh." };
  if (found.b.status !== "in_review") return { ok: false, error: "Only while in review." };
  if (found.m.status === "sent") return { ok: false, error: "Already sent." };
  if (skip) await c.store.updateMessage(found.m.id, { status: "skipped", error: null, skipReason: null });
  else await c.store.updateMessage(found.m.id, { status: found.m.bubbles.length ? "drafted" : "draft_failed", skipReason: null });
  return { ok: true };
}

/** "Include anyway": only un-collapses a link-guard draft; it still needs Approve. */
export async function includeAnyway(workspaceId: string, messageId: string, on: boolean, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone. Refresh." };
  if (!found.m.leftOutReason) return { ok: false, error: "They're already in." };
  if (found.m.status === "sent") return { ok: false, error: "Already sent." };
  await c.store.updateMessage(found.m.id, { includedAnyway: on, ...(on ? {} : { status: found.m.status === "approved" ? "drafted" : found.m.status }) });
  return { ok: true };
}

// ---------------------------------------------------------------- Send myself

/** The draft for the inbox composer (Send myself): its bubbles and follow-up, unchanged. */
export async function draftForComposer(workspaceId: string, messageId: string, deps: EngineDeps = {}): Promise<{ bubbles: string[]; name: string } | null> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found || found.m.status === "sent" || !found.m.bubbles.length) return null;
  return { bubbles: [...found.m.bubbles, ...found.m.followupBubbles], name: found.b.name };
}

/** After Kevin's inbox send succeeds: the draft is skipped "sent by Kevin" and his links kept for the guard. */
export async function markSentByKevin(workspaceId: string, messageId: string, sent: string[], deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const found = await messageIn(c, workspaceId, messageId);
  if (!found) return { ok: false, error: "That draft is gone." };
  if (found.m.status === "sent") return { ok: true };
  const links = [...new Set(sent.flatMap((t) => t.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((u) => u.replace(/[),.!?]+$/, "")))];
  await c.store.updateMessage(found.m.id, { status: "skipped", skipReason: "sent_by_kevin", sentLinks: links, error: null });
  await settle(c.store, found.run, found.b.workspaceId);
  return { ok: true };
}

// ---------------------------------------------------------------- send

export interface ReviewPlan {
  approved: number;
  unchecked: number;
  figures: CapFigures;
  /** Why Send is off, or null. */
  blocked: string | null;
  /** A warning that doesn't block (Window over the cap). */
  warning: string | null;
  /** "Send 18 · 4 unchecked won't send" */
  label: string;
}

/** What Review's Send bar says: approved, cap figures in planned messages, about N fit, extend. */
export async function reviewPlan(workspaceId: string, b: BroadcastView, messages: BroadcastMessageView[], deps: EngineDeps = {}): Promise<ReviewPlan> {
  const c = ctx(deps);
  const capNow = await c.cap(workspaceId, c.now);
  const approved = messages.filter((m) => m.status === "approved");
  const unchecked = messages.filter((m) => m.status === "drafted" && !collapsed(m)).length;
  const w = sendWindow(b, c.now);
  const figures = capFigures({ perPersonPlanned: approved.map(plannedOf), cap: capNow, today: w.today, mode: b.startMode, start: w.start, end: w.end, now: c.now, tz: b.timezone });
  const verb = b.startMode === "now" ? "Send" : "Schedule";
  const label = `${verb} ${approved.length}${unchecked ? ` · ${unchecked} unchecked won't send` : ""}`;
  let blocked: string | null = null;
  if (capNow.pausedAll) blocked = "Pause all is on.";
  else if (!approved.length) blocked = "Approve at least one draft.";
  else if (b.startMode === "now" && figures.full) blocked = `Today's cap is full (${capNow.sentToday}/${capNow.cap}). Pick a window on another day.`;
  else if (b.startMode === "now") blocked = nowEndError(b.windowEnd, c.now, b.timezone);
  else blocked = windowError(b.sendDate, b.windowStart, b.windowEnd, c.now, b.timezone);
  const warning = b.startMode === "window" && figures.over ? `${figures.planned} planned is over that day's cap (${figures.left}). Some won't send.` : null;
  return { approved: approved.length, unchecked, figures, blocked, warning, label };
}

/** Now: push the end time later (never past 23:00 local). */
export async function extendEnd(workspaceId: string, key: string, to: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  if (b.startMode !== "now") return { ok: false, error: "Only for Now." };
  if (!validTime(to) || to > EXTEND_LIMIT) return { ok: false, error: `Not past ${EXTEND_LIMIT}.` };
  if (to <= b.windowEnd) return { ok: false, error: "Pick a later time." };
  await c.store.update(workspaceId, b.id, { windowEnd: to });
  return { ok: true };
}

export interface SendResult {
  scheduled: number;
  capped: number;
  outside: number;
  /** Skipped at the audience re-check. */
  leftOut: number;
  /** Tagged since drafting, not included. */
  taggedSince: number;
  queued: boolean;
}

/**
 * Send (Now) / Schedule (Window). Only approved drafts. The audience is
 * re-checked (lost the tag, archived, spam, paused, Personal → skipped); people
 * tagged since aren't added. Times: random, inside the window and each
 * person's 24h window; what passes the cap (in planned messages) is held back.
 */
export async function sendBroadcast(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<SendResult>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  if (b.status !== "in_review") return { ok: false, error: b.status === "drafting" ? "J is still drafting." : "Nothing to send." };
  const run = await c.store.runOf(b.id);
  if (!run) return { ok: false, error: "Make drafts first." };
  const all = await c.store.messages(run.id);
  const plan = await reviewPlan(workspaceId, b, all, deps);
  if (plan.blocked) return { ok: false, error: plan.blocked };

  // Now: the window starts now, today; written down so the send path reads it.
  const w = sendWindow(b, c.now);
  const live = b.startMode === "now" ? await c.store.update(workspaceId, b.id, { sendDate: w.date, windowStart: hhmmIn(c.now, b.timezone) }) : b;
  if (run.runDate !== w.date) await c.store.updateRun(run.id, { runDate: w.date });

  // Audience re-check.
  const { tag } = await audienceContacts(c, workspaceId, live);
  const approved = all.filter((m) => m.status === "approved");
  let leftOut = 0;
  const ready: { m: BroadcastMessageView; contact: BroadcastContact }[] = [];
  for (const m of approved) {
    const contact = await c.store.contact(workspaceId, m.contactId);
    const why: SkipReason | null = !contact
      ? "contact_gone"
      : live.audienceTagId
        ? contact.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
          ? null
          : "left_the_tag"
        : live.contactIds.includes(contact.contactId)
          ? null
          : "left_the_tag";
    const ex = !why && contact ? excludedReason(contact) : null;
    const code = why ?? (ex ? excludedCode(ex) : null);
    if (code) {
      leftOut++;
      await c.store.updateMessage(m.id, { status: "skipped", skipReason: code, error: SKIP_LABEL[code] });
      continue;
    }
    ready.push({ m, contact: contact! });
  }
  const known = new Set(all.map((m) => m.contactId));
  const now = await audienceContacts(c, workspaceId, live);
  const taggedSince = now.contacts.filter((x) => !known.has(x.contactId) && (!tag || x.tags.includes(tag))).length;

  const capNow = await c.cap(workspaceId, c.now);
  const capLeft = Math.max(0, w.today ? capNow.cap - capNow.sentToday : capNow.cap);
  const { windowState } = await import("@/lib/os/setter/state");
  const from = new Date(Math.max(w.start.getTime(), c.now.getTime()));
  const deadlineOf = (ct: BroadcastContact): number | null => {
    const [st, until] = windowState(ct.theirLastAt, from, getSetterConfig());
    return st === "free" && until ? Math.min(new Date(until).getTime(), w.end.getTime()) : 0;
  };
  const outcome = assignSchedule(
    ready.map(({ m, contact }) => ({ id: m.id, bubbles: plannedOf(m), deadline: deadlineOf(contact) })),
    { start: w.start, end: w.end, tz: live.timezone, rng: seededRng(`${run.id}:send:${c.now.getTime()}`), capLeft, now: c.now }
  );
  let scheduled = 0;
  let capped = 0;
  let outside = 0;
  let queued = true;
  for (const o of outcome) {
    if (o.status === "scheduled") {
      await c.store.updateMessage(o.id, { status: "scheduled", scheduledAt: new Date(o.at).toISOString(), error: null, skipReason: null });
      queued = (await c.enqueue({ messageId: o.id, part: "main" }, o.at)) && queued;
      scheduled++;
    } else if (o.status === "capped") {
      capped++;
      await c.store.updateMessage(o.id, { status: "skipped", skipReason: "cap", error: "Over the daily send cap" });
    } else {
      outside++;
      const code: SkipReason = o.reason.includes("window is over") ? "window_end" : "their_window";
      await c.store.updateMessage(o.id, { status: "outside_window", skipReason: code, error: o.reason, scheduledAt: null });
    }
  }
  if (scheduled) {
    await c.store.updateRun(run.id, { status: "scheduled" });
    await c.store.update(workspaceId, b.id, { status: "scheduled" });
  } else {
    await c.store.updateRun(run.id, { status: "done" });
    await c.store.update(workspaceId, b.id, { status: "sent" });
  }
  return { ok: true, scheduled, capped, outside, leftOut, taggedSince, queued };
}

function hhmmIn(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * After a message settles (sent, skipped, failed): the broadcast is sending
 * once one is sent, and sent when nothing is left to go.
 */
export async function settle(store: BroadcastStore, run: BroadcastRunView, workspaceId: string): Promise<void> {
  const b = await store.getById(run.broadcastId);
  if (!b || b.status === "cancelled" || b.status === "draft" || b.status === "drafting" || b.status === "in_review") return;
  const msgs = await store.messages(run.id);
  const left = msgs.some((m) => m.status === "scheduled");
  if (!left) {
    await store.updateRun(run.id, { status: "done" });
    if (b.status !== "sent") await store.update(workspaceId, b.id, { status: "sent" });
  } else if (b.status === "scheduled" && msgs.some((m) => m.status === "sent")) {
    await store.update(workspaceId, b.id, { status: "sending" });
  }
}

/**
 * Cancel, before sent. Before Send: stops drafting and keeps the drafts.
 * Scheduled or sending: still-scheduled messages are skipped "cancelled",
 * pending follow-ups don't go and queued jobs find nothing to send.
 */
export async function cancelBroadcast(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ sent: number; cancelled: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  if (b.status === "sent") return { ok: false, error: "Already sent." };
  if (b.status === "cancelled") return { ok: true, sent: 0, cancelled: 0 };
  const run = await c.store.runOf(b.id);
  let cancelled = 0;
  let sent = 0;
  if (run) {
    for (const m of await c.store.messages(run.id)) {
      if (m.status === "sent") sent++;
      if ((b.status === "scheduled" || b.status === "sending") && (m.status === "scheduled" || m.status === "approved")) {
        await c.store.updateMessage(m.id, { status: "skipped", skipReason: "cancelled", error: "Cancelled" });
        cancelled++;
      }
    }
    if (b.status === "scheduled" || b.status === "sending") await c.store.updateRun(run.id, { status: "done" });
  }
  await c.store.update(workspaceId, b.id, { status: "cancelled" });
  return { ok: true, sent, cancelled };
}

/** Reopen a cancelled draft (before anything was scheduled) so it can be edited again. */
export async function reopenBroadcast(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b || b.status !== "cancelled") return { ok: false, error: "Nothing to reopen." };
  const run = await c.store.runOf(b.id);
  const msgs = run ? await c.store.messages(run.id) : [];
  if (msgs.some((m) => m.status === "sent" || m.skipReason === "cancelled")) return { ok: false, error: "It already went out. Duplicate it instead." };
  await c.store.update(workspaceId, b.id, { status: msgs.length ? "in_review" : "draft" });
  if (run && msgs.length) await c.store.updateRun(run.id, { status: "review" });
  return { ok: true };
}

// ---------------------------------------------------------------- not sent

/** Redraft the "wrote since drafting" group from the new thread, back to Review. */
export async function redraftWroteSince(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ total: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  if (b.status !== "sent") return { ok: false, error: "Only once it has finished." };
  const run = await c.store.runOf(b.id);
  const group = run ? (await c.store.messages(run.id)).filter((m) => m.skipReason === "wrote_since_drafting") : [];
  if (!run || !group.length) return { ok: false, error: "No one wrote since drafting." };
  const people: { e: AudienceEntry; had: boolean }[] = [];
  for (const m of group) {
    const contact = await c.store.contact(workspaceId, m.contactId);
    if (contact) people.push({ e: { contact, verdict: "eligible", reason: null, deadline: null }, had: false });
  }
  await c.store.updateRun(run.id, { status: "drafting", createdAt: c.now.toISOString() });
  await c.store.update(workspaceId, b.id, { status: "drafting" });
  await c.background(() => draftPeople(workspaceId, { ...b, status: "drafting" }, { ...run, status: "drafting" }, people, deps));
  return { ok: true, total: people.length };
}

/** "New broadcast to these N": a draft with the same messages, agent and mode, to exactly the unsent. */
export async function newBroadcastToUnsent(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<Result<{ key: string; count: number }>> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return { ok: false, error: "Broadcast not found." };
  const run = await c.store.runOf(b.id);
  const ids = run ? (await c.store.messages(run.id)).filter((m) => m.skipReason && NOT_SENT_REASONS.includes(m.skipReason)).map((m) => m.contactId) : [];
  if (!ids.length) return { ok: false, error: "Everyone approved was sent." };
  const name = `${b.name.replace(/\s*·\s*not sent$/, "")} · not sent`;
  const copy = await c.store.create(workspaceId, {
    key: await uniqueKey(c, workspaceId, name),
    name,
    audienceTagId: null,
    contactIds: [...new Set(ids)],
    status: "draft",
    startMode: "now",
    sendDate: null,
    bubbles: b.bubbles.map((x) => ({ ...x })),
    personaliseMode: b.personaliseMode,
    variations: b.variations.map((v) => [...v]),
    duplicatedFromId: b.id,
    followupTemplate: b.followupTemplate,
    followupDelayMin: b.followupDelayMin,
    windowStart: b.windowStart,
    windowEnd: defaultNowEnd(c.now, b.timezone),
    timezone: b.timezone,
    setterId: b.setterId,
  });
  return { ok: true, key: copy.key, count: ids.length };
}

// ---------------------------------------------------------------- what needs Kevin

export interface BroadcastNeed {
  key: string;
  name: string;
  runDate: string;
  today: boolean;
  /** "review": drafts waiting (the only kind one-off broadcasts give). */
  kind: "link" | "review";
  /** Drafts waiting. */
  count: number;
  windowStart: string;
  /** "Fri" */
  day: string;
  href: string;
}

/** Broadcasts in review, with their draft count (Home's slot, the Automations badge). */
export async function broadcastNeeds(workspaceId: string, deps: EngineDeps = {}): Promise<BroadcastNeed[]> {
  const c = ctx(deps);
  const out: BroadcastNeed[] = [];
  for (const b of await c.store.list(workspaceId)) {
    if (b.status !== "in_review") continue;
    const run = await c.store.runOf(b.id);
    const drafts = run ? (await c.store.messages(run.id)).filter((m) => m.status === "drafted" || m.status === "approved").length : 0;
    const date = b.sendDate ?? localDate(c.now, b.timezone);
    out.push({
      key: b.key,
      name: b.name,
      runDate: date,
      today: date === localDate(c.now, b.timezone),
      kind: "review",
      count: drafts,
      windowStart: b.windowStart,
      day: dayLabel(date, b.timezone).split(" ")[0],
      href: `/os/automations/broadcasts/${b.key}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- the list

export type Tone = "neutral" | "warn" | "good" | "ink" | "bad";

export interface BroadcastListItem {
  key: string;
  name: string;
  /** "Fri 24 Oct", "Now · until 18:00", "No date yet" */
  date: string;
  tag: string;
  /** "3 · DM Script Vault" */
  messages: string;
  personalised: string;
  status: BroadcastStatus;
  statusLabel: string;
  tone: Tone;
  /** "24 · 2 not sent", "0 of 22", "—" */
  sent: string;
}

export const MODE_LABEL: Record<PersonaliseMode, string> = { per_person: "Per person", variations: "5 variations", as_written: "As written" };

function linkLabel(b: BroadcastView): string {
  const l = b.bubbles.find((x) => x.type === "link");
  if (!l || l.type !== "link") return "";
  if (!l.url) return "pick a link";
  return l.label || shortLink(l.url);
}

export interface Progress {
  sent: number;
  scheduled: number;
  cancelled: number;
  notSent: number;
  drafts: number;
  drafted: number;
  failed: number;
}

export function progressOf(msgs: BroadcastMessageView[]): Progress {
  const n = (f: (m: BroadcastMessageView) => boolean) => msgs.filter(f).length;
  return {
    sent: n((m) => m.status === "sent"),
    scheduled: n((m) => m.status === "scheduled"),
    cancelled: n((m) => m.skipReason === "cancelled"),
    notSent: n((m) => Boolean(m.skipReason && NOT_SENT_REASONS.includes(m.skipReason))),
    drafts: n((m) => m.status === "drafted" || m.status === "approved"),
    drafted: n((m) => m.status === "drafted" || m.status === "approved" || m.status === "draft_failed"),
    failed: n((m) => m.status === "draft_failed"),
  };
}

export function statusText(b: Pick<BroadcastView, "status">, p: Progress, draftingTotal: number): { label: string; tone: Tone } {
  switch (b.status) {
    case "drafting":
      return { label: `Drafting ${Math.min(p.drafted, draftingTotal)} of ${draftingTotal}`, tone: "neutral" };
    case "in_review":
      return { label: `In review · ${p.drafts} drafts ready`, tone: "warn" };
    case "scheduled":
      return { label: "Scheduled", tone: "neutral" };
    case "sending":
      return { label: "Sending", tone: "ink" };
    case "sent":
      return { label: "Sent", tone: "good" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    default:
      return { label: "Draft", tone: "neutral" };
  }
}

function sentText(b: Pick<BroadcastView, "status">, p: Progress): string {
  if (b.status === "scheduled" || b.status === "sending") return `${p.sent} of ${p.sent + p.scheduled}`;
  if (b.status === "sent") return `${p.sent}${p.notSent ? ` · ${p.notSent} not sent` : ""}`;
  if (b.status === "cancelled" && (p.sent || p.cancelled)) return `${p.sent} · ${p.cancelled} cancelled`;
  return "—";
}

/** Every broadcast, newest first. */
export async function loadBroadcastList(workspaceId: string, deps: EngineDeps = {}): Promise<BroadcastListItem[]> {
  const c = ctx(deps);
  const out: BroadcastListItem[] = [];
  for (const b of await c.store.list(workspaceId)) {
    const run = await c.store.runOf(b.id);
    const msgs = run ? await c.store.messages(run.id) : [];
    const p = progressOf(msgs);
    const who = b.status === "drafting" ? await whoFor(c, workspaceId, b).catch(() => null) : null;
    const st = statusText(b, p, Math.max(who ? who.get.length + who.hadLink.length : 0, p.drafted));
    const link = linkLabel(b);
    out.push({
      key: b.key,
      name: b.name,
      date: startLabel(b),
      tag: b.audienceTagId ? await tagNameOf(c, workspaceId, b) : `${b.contactIds.length} people`,
      messages: `${perPerson(b)}${link ? ` · ${link}` : ""}`,
      personalised: MODE_LABEL[b.personaliseMode],
      status: b.status,
      statusLabel: st.label,
      tone: st.tone,
      sent: sentText(b, p),
    });
  }
  return out;
}

/** The Automations nav badge: broadcasts in review. */
export async function inReviewCount(workspaceId: string, deps: EngineDeps = {}): Promise<number> {
  const c = ctx(deps);
  return (await c.store.list(workspaceId)).filter((b) => b.status === "in_review").length;
}

// ---------------------------------------------------------------- one broadcast

export interface ReviewItem extends BroadcastMessageView {
  handle: string;
  initial: string;
  conversationId: string | null;
  /** "last chat 2d ago", "Live · Qualify" */
  why: string;
  /** Text bubbles and the link bubbles, for the card. */
  text: string[];
  links: string[];
  collapsed: boolean;
  /** Link guard: "sent 17 Oct". */
  hadWhen: string | null;
}

export interface BroadcastPage {
  broadcast: BroadcastView;
  status: { label: string; tone: Tone };
  start: { label: string; defaultNowEnd: string; today: string };
  who: { tag: string; total: number; getIt: number; rows: { label: string; n: number; main: boolean }[]; fixed: number | null } | null;
  perPerson: number;
  emptyLink: boolean;
  drafting: { done: number; total: number } | null;
  review: { items: ReviewItem[]; plan: ReviewPlan } | null;
  failedDrafts: ReviewItem[];
  progress: Progress;
  notSent: { reason: SkipReason; label: string; people: { contactId: string; handle: string }[] }[];
  earlier: { key: string; name: string; status: BroadcastStatus; date: string }[];
  /** True when the run has drafts (Who/Messages/Personalise changes ask first). */
  hasDrafts: boolean;
}

function ago(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const h = (now.getTime() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return "last chat <1h ago";
  if (h < 48) return `last chat ${Math.round(h)}h ago`;
  return `last chat ${Math.round(h / 24)}d ago`;
}

export async function loadBroadcast(workspaceId: string, key: string, deps: EngineDeps = {}): Promise<BroadcastPage | null> {
  const c = ctx(deps);
  const b = await c.store.get(workspaceId, key);
  if (!b) return null;
  const tag = await tagNameOf(c, workspaceId, b);
  const view = { ...b, audienceTag: tag };
  const run = await c.store.runOf(b.id);
  const msgs = run ? await c.store.messages(run.id) : [];
  const p = progressOf(msgs);
  const editable = b.status === "draft" || b.status === "in_review" || b.status === "drafting";
  const who = editable && (b.audienceTagId || b.contactIds.length) ? await whoFor(c, workspaceId, view).catch(() => null) : null;
  const draftingTotal = b.status === "drafting" ? Math.max(p.drafted, (who?.get.length ?? 0) + (who?.hadLink.length ?? 0)) : 0;

  const contactIds = msgs.map((m) => m.contactId);
  const contacts = new Map((contactIds.length ? await Promise.all(contactIds.map((id) => c.store.contact(workspaceId, id))) : []).flatMap((x) => (x ? [[x.contactId, x] as const] : [])));
  const traces = msgs.some((m) => m.leftOutReason) ? await c.store.sentTraces(workspaceId, b.id) : [];
  const had = alreadyHadLink(bubbleLinks(b.bubbles), traces);
  const item = (m: BroadcastMessageView): ReviewItem => {
    const ct = contacts.get(m.contactId);
    const handle = ct ? handleOf(ct) : m.contactId;
    const last = ct ? Math.max(ct.theirLastAt ? Date.parse(ct.theirLastAt) : 0, ct.ourLastAt ? Date.parse(ct.ourLastAt) : 0) : 0;
    const when = had.get(m.contactId);
    return {
      ...m,
      handle,
      initial: handle[0]?.toUpperCase() ?? "?",
      conversationId: ct?.conversationId ?? null,
      why: ct ? (last ? (ago(new Date(last).toISOString(), c.now) ?? "") : "no chat yet") : "",
      text: textOnly(m.bubbles),
      links: m.bubbles.filter((x) => URL_ONLY.test(x.trim())),
      collapsed: collapsed(m),
      hadWhen: when ? `sent ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: b.timezone }).format(new Date(when))}` : m.leftOutReason ? "had it before" : null,
    };
  };
  const reviewable = msgs.filter((m) => ["drafted", "approved", "scheduled", "sent", "failed", "skipped", "outside_window"].includes(m.status) && (m.status !== "skipped" || m.skipReason !== null || m.bubbles.length > 0));
  const showReview = b.status !== "draft" && msgs.length > 0;
  const notSent = NOT_SENT_REASONS.map((reason) => ({
    reason,
    label: SKIP_LABEL[reason],
    people: msgs.filter((m) => m.skipReason === reason).map((m) => ({ contactId: m.contactId, handle: contacts.get(m.contactId) ? handleOf(contacts.get(m.contactId)!) : m.contactId })),
  })).filter((g) => g.people.length);
  // The kept weekly draft lists the broadcasts sent from it ("Earlier sends").
  const earlier = (b.status === "draft" ? await c.store.list(workspaceId) : [])
    .filter((x) => x.duplicatedFromId === b.id && x.status !== "draft")
    .map((x) => ({ key: x.key, name: x.name, status: x.status, date: startLabel(x) }));

  return {
    broadcast: view,
    status: statusText(b, p, draftingTotal),
    start: { label: startLabel(b), defaultNowEnd: defaultNowEnd(c.now, b.timezone), today: localDate(c.now, b.timezone) },
    who: who ? { tag: who.tag, total: who.total, getIt: who.get.length, rows: who.rows, fixed: b.audienceTagId ? null : b.contactIds.length } : null,
    perPerson: perPerson(b),
    emptyLink: hasEmptyLink(b.bubbles),
    drafting: b.status === "drafting" ? { done: Math.min(p.drafted, draftingTotal), total: draftingTotal } : null,
    review: showReview ? { items: reviewable.map(item), plan: await reviewPlan(workspaceId, b, msgs, deps) } : null,
    failedDrafts: msgs.filter((m) => m.status === "draft_failed").map(item),
    progress: p,
    notSent: b.status === "sent" || b.status === "cancelled" ? notSent : [],
    earlier,
    hasDrafts: msgs.some((m) => m.status === "drafted" || m.status === "approved" || m.status === "draft_failed"),
  };
}

// Kept for the inbox panel's "J personalises" context line.
export { threadState, linksIn, lastInbound };
