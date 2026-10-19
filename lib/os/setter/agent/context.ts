// What one tool-using turn knows (AgentEnv), what it has seen so far
// (TurnState), and the read tools that answer from them. The read tools are
// safe to run straight away: they never write anything.

import { isTimeZone } from "@/lib/os/integrations/calendar/settings";
import { filterSlots, formatSlot, guessTimezone, pickOptions, slotId, tzCity } from "@/lib/os/integrations/calendar/slots";
import type { ActiveCalendar } from "@/lib/os/integrations/calendar/store";
import type { CalendarSlot } from "@/lib/os/integrations/calendar/types";
import type { TraceLine } from "@/lib/os/setter/agent/trace";
import { EXITS } from "@/lib/os/setter/agent/tools";
import type { BookingContext } from "@/lib/os/setter/booking";
import type { ResolvedSetter } from "@/lib/os/setter/kb";
import { bookingLinkOf } from "@/lib/os/setter/profile";
import type { SetterRecord, ThreadMessage } from "@/lib/os/setter/state";

export interface AgentContact {
  id: string | null;
  username: string | null;
  fullName?: string | null;
  email?: string | null;
  tags: string[];
  /** The CRM column (Contact.stage). */
  stage?: string | null;
  setterStage?: string | null;
  paused: boolean;
}

export interface FieldValueView {
  key: string;
  label?: string;
  value: string;
  /** "j", "user" (Kevin), "system"… */
  source: string;
}

export interface AgentEnv {
  now: Date;
  contact: AgentContact;
  rec: SetterRecord;
  msgs: ThreadMessage[];
  setter: ResolvedSetter;
  /** Instagram's window is closed: every action is dropped. */
  windowClosed: boolean;
  /** The booking calendar; null = no check_calendar / book_call this turn. */
  calendar: ActiveCalendar | null;
  /** This contact's assigned A/B lines (only the assigned variant). */
  lines: TraceLine[];
  /** Sandbox: actions are recorded in the trace, never queued for real. */
  dry: boolean;
  /** Fields filled so far, with who filled them. */
  fieldValues?: () => Promise<FieldValueView[]>;
  /** Past bookings, newest first. */
  bookings?: () => Promise<unknown[]>;
}

/** What the turn has learned so far (the server's memory, not J's). */
export interface TurnState {
  /** Every free time check_calendar returned this turn, by id. */
  slots: Map<string, CalendarSlot>;
  options: CalendarSlot[];
  leadTz: string | null;
}

export function newTurnState(): TurnState {
  return { slots: new Map(), options: [], leadTz: null };
}

/** The calendar is only offered when it can book (an event type is picked). */
export function usableCalendar(cal: ActiveCalendar | null | undefined): ActiveCalendar | null {
  return cal && cal.eventTypeId ? cal : null;
}

// ---------------------------------------------------------------- resources
export interface SendableResource {
  slug: string;
  title: string;
  kind: string;
  summary: string;
  url: string;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** The links J may send this turn (send_resource), by slug: this setter's
 *  active lead magnets, its best episodes, and the booking link when there is
 *  no calendar to book on (or as the calendar's fallback). */
export function sendableResources(setter: ResolvedSetter, calendar: ActiveCalendar | null): Map<string, SendableResource> {
  const out = new Map<string, SendableResource>();
  for (const r of setter.offered.resources) {
    if (r.type === "setter" || r.status !== "active") continue;
    const url = r.zernio?.button_url || r.resource_url || "";
    if (!url) continue;
    out.set(r.slug, { slug: r.slug, title: r.name ?? r.slug, kind: r.resource_kind || "resource", summary: r.for_setter || r.blurb || "", url });
  }
  for (const e of setter.profile.episodes ?? []) {
    if (!e.link.trim()) continue;
    const slug = `episode-${slugify(e.name)}`;
    out.set(slug, { slug, title: e.name, kind: "episode", summary: e.when, url: e.link.trim() });
  }
  const sections = setter.profile.business?.sections ?? {};
  const link = calendar ? (calendar.fallbackLink ?? "") : bookingLinkOf(setter.profile.settings) || sections.booking_link || setter.profile.settings?.cal_com_url || "";
  if (link) out.set("booking_link", { slug: "booking_link", title: "Booking link", kind: "booking", summary: calendar ? "Only when no offered time fits" : "Where they book the call", url: link });
  return out;
}

// ---------------------------------------------------------------- read tools
export type ReadResult = { ok: true; output: unknown; summary: string } | { ok: false; error: string };

export async function getContact(env: AgentEnv): Promise<ReadResult> {
  const { contact, rec } = env;
  const [fields, bookings] = await Promise.all([env.fieldValues?.().catch(() => []) ?? [], env.bookings?.().catch(() => []) ?? []]);
  const known = new Map(fields.map((f) => [f.key, f]));
  // Fields J fills that are still empty: what's worth learning next.
  const missing = (env.setter.profile.fields ?? []).filter((f) => !known.has(f.key)).map((f) => f.key);
  const output = {
    name: contact.fullName ?? rec.name ?? null,
    handle: contact.username ? `@${contact.username}` : `@${rec.handle}`,
    email: rec.email ?? contact.email ?? null,
    stage: rec.stage ?? contact.setterStage ?? null,
    crm_stage: contact.stage ?? null,
    tags: contact.tags,
    fields: fields.map((f) => ({ key: f.key, value: f.value, filled_by: f.source === "user" ? "kevin" : f.source })),
    fields_missing: missing,
    arrived_via: rec.entry ? { via: rec.entry.via, keyword: rec.entry.keyword ?? null, resource: rec.entry.slug ?? null } : null,
    resources_sent: rec.resources_sent ?? [],
    invited: rec.invited ?? null,
    booking: rec.booking ? { phase: rec.booking.phase, start: rec.booking.start ?? null, picked: rec.booking.picked ?? null, timezone: rec.booking.timezone ?? null } : null,
    bookings,
  };
  return { ok: true, output, summary: `${fields.length} field${fields.length === 1 ? "" : "s"}, ${contact.tags.length} tag${contact.tags.length === 1 ? "" : "s"}` };
}

/** Stub until workflows exist (stream C1): the setter-level goal, no lead
 *  magnet rule, no release rules, plus this contact's assigned test lines.
 *  The shape is the one a Setter step will fill. */
export interface StepView {
  goal: string;
  leadMagnet: { mode: "hold" | "send_first" | "none"; resources: { slug: string; title: string; released: boolean }[] };
  releaseRules: { id: string; when: string }[];
  exits: string[];
  lines: TraceLine[];
}

export function stepView(env: AgentEnv): StepView {
  return { goal: "book_call", leadMagnet: { mode: "none", resources: [] }, releaseRules: [], exits: [...EXITS], lines: env.lines };
}

export async function getStep(env: AgentEnv): Promise<ReadResult> {
  const out = stepView(env);
  return { ok: true, output: out, summary: `goal ${out.goal}, ${out.lines.length} test line${out.lines.length === 1 ? "" : "s"}` };
}

function dayStart(s: unknown): Date | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Most free times listed besides the suggested ones (as the CALENDAR block). */
const MORE_TIMES = 24;

export async function checkCalendar(env: AgentEnv, state: TurnState, input: { from?: unknown; to?: unknown; tz?: unknown }): Promise<ReadResult> {
  const cal = usableCalendar(env.calendar);
  if (!cal) return { ok: false, error: "No calendar is connected for this setter." };
  const s = cal.settings;
  const earliest = new Date(env.now.getTime() + s.minNoticeHours * 3600_000);
  const latest = new Date(env.now.getTime() + s.daysAhead * 86_400_000);
  const from = dayStart(input.from);
  const toDay = dayStart(input.to);
  const start = from && from > earliest ? from : earliest;
  const end = toDay && new Date(toDay.getTime() + 86_400_000) < latest ? new Date(toDay.getTime() + 86_400_000) : latest;
  if (start >= end) return { ok: false, error: `Nothing to look at: the calendar opens ${s.minNoticeHours}h from now and goes ${s.daysAhead} days ahead.` };
  let raw: CalendarSlot[];
  try {
    raw = await cal.client.getAvailableSlots(cal.eventTypeId!, { start, end }, s.hostTimezone);
  } catch (err) {
    return { ok: false, error: `The calendar didn't answer: ${err instanceof Error ? err.message : String(err)}` };
  }
  const taken = new Set((env.rec.booking?.taken ?? []).map((t) => slotId(t)));
  const slots = filterSlots(raw, s, env.now, cal.durationMinutes).filter((x) => !taken.has(x.start) && new Date(x.start) >= start && new Date(x.start) < end);
  const said = env.msgs.filter((m) => m.incoming).map((m) => m.text);
  const tz =
    (isTimeZone(input.tz) ? input.tz : null) ??
    state.leadTz ??
    (isTimeZone(env.rec.booking?.timezone) ? env.rec.booking!.timezone! : null) ??
    guessTimezone(said);
  const options = pickOptions(slots, s.options, tz);
  for (const x of slots) state.slots.set(x.start, x);
  state.options = options;
  if (tz) state.leadTz = tz;
  const host = s.hostTimezone;
  const view = (x: CalendarSlot) => ({ id: x.start, their_time: tz ? formatSlot(x.start, tz) : null, kevin_time: formatSlot(x.start, host) });
  const fallback = cal.fallbackLink ? " If none fits, send_resource('booking_link')." : "";
  const output = {
    timezone: tz,
    note: tz
      ? `Times in their timezone (${tzCity(tz)}). Offer the suggested ones, in their time.${fallback}`
      : `Their timezone is UNKNOWN: ask where they're based before offering times. kevin_time is ${tzCity(host)} time.${fallback}`,
    suggested: options.map(view),
    more: slots
      .filter((x) => !options.includes(x))
      .slice(0, MORE_TIMES)
      .map(view),
    taken_since_last_offer: (env.rec.booking?.taken ?? []).length ? env.rec.booking!.taken : undefined,
  };
  return { ok: true, output, summary: slots.length ? `${slots.length} free time${slots.length === 1 ? "" : "s"}, ${options.length} suggested` : "no free times" };
}

/** The BookingContext the legacy path builds, from what check_calendar saw
 *  this turn: applyBookingReply then makes the exact same booking draft. */
export function bookingContextFrom(env: AgentEnv, state: TurnState): BookingContext | null {
  const cal = usableCalendar(env.calendar);
  if (!cal || !state.slots.size) return null;
  const slots = [...state.slots.values()].sort((a, b) => a.start.localeCompare(b.start));
  const mode = cal.provider === "calendly" && !cal.settings.directBooking ? "link" : "book";
  return { calendar: cal, slots, options: state.options, leadTz: state.leadTz, mode };
}

export async function getResource(env: AgentEnv, input: { slug?: unknown }): Promise<ReadResult> {
  const slug = typeof input.slug === "string" ? input.slug.trim() : "";
  const r = sendableResources(env.setter, usableCalendar(env.calendar)).get(slug);
  if (!r) {
    const all = [...sendableResources(env.setter, usableCalendar(env.calendar)).keys()];
    return { ok: false, error: `No resource "${slug}" for this setter. Ones you may send: ${all.join(", ") || "none"}.` };
  }
  const output = { slug: r.slug, title: r.title, kind: r.kind, summary: r.summary, has_link: true, already_sent: (env.rec.resources_sent ?? []).includes(r.slug) };
  return { ok: true, output, summary: r.title };
}

// ---------------------------------------------------------------- knowledge search
interface Passage {
  source: string;
  text: string;
}

function passages(setter: ResolvedSetter): Passage[] {
  const p = setter.profile;
  const out: Passage[] = [];
  for (const [k, v] of Object.entries(p.business?.sections ?? {})) if (v?.trim()) out.push({ source: `Business › ${k}`, text: v.trim() });
  for (const o of p.business?.objections ?? []) out.push({ source: "Objections", text: `${o.objection} → ${o.response}` });
  for (const o of p.offers ?? []) {
    const bits = [o.pitch, o.fit_criteria && `Fit: ${o.fit_criteria}`, o.length && `Length: ${o.length}`, o.notes].filter(Boolean);
    out.push({ source: `Offers › ${o.name} (${o.status})`, text: bits.join("\n") || o.name });
  }
  for (const block of [p.voiceExamples, p.examples]) {
    for (const para of (block ?? "").split(/\n\s*\n/)) if (para.trim().length > 20) out.push({ source: "Examples", text: para.trim() });
  }
  for (const e of p.episodes ?? []) out.push({ source: "Best episodes", text: `${e.name}: ${e.when}` });
  for (const c of p.voiceCorrections ?? []) out.push({ source: "Voice corrections", text: `${c.title}\n${c.body}` });
  return out;
}

const STOP = new Set(["the", "and", "for", "what", "with", "how", "they", "about", "this", "that", "you", "are"]);

export async function searchKnowledge(env: AgentEnv, input: { query?: unknown }): Promise<ReadResult> {
  const q = typeof input.query === "string" ? input.query.toLowerCase() : "";
  const terms = [...new Set(q.split(/[^a-z0-9€$£]+/).filter((t) => t.length >= 3 && !STOP.has(t)))];
  if (!terms.length) return { ok: false, error: "Give a few words to search for." };
  const scored = passages(env.setter)
    .map((p) => {
      const hay = `${p.source} ${p.text}`.toLowerCase();
      const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 + Math.min(3, hay.split(t).length - 2) * 0.25 : 0), 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const output = { results: scored.map((x) => ({ source: x.p.source, text: x.p.text.slice(0, 900) })) };
  return { ok: true, output, summary: `${scored.length} passage${scored.length === 1 ? "" : "s"}` };
}
