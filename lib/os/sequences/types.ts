// Follow-up sequences: the shapes and the defaults. Pure (client components
// import it). Each setter has one row per sequence (FollowupSequence); a
// missing row means the default below, switched on.
//
// The method (research §4, Max Inhouse): value first, then social proof, a
// direct ask, a breakup. Never pushy: every step can hold (J may choose to
// say nothing), and a reply stops the sequence at once.

export const NO_REPLY_KEYS = ["no_reply_lead", "no_reply_qualifying", "no_reply_value", "no_reply_invite"] as const;
export const SEQUENCE_KEYS = [...NO_REPLY_KEYS, "pre_call", "no_show", "showed"] as const;
export type NoReplyKey = (typeof NO_REPLY_KEYS)[number];
export type SequenceKey = (typeof SEQUENCE_KEYS)[number];

export function isSequenceKey(v: unknown): v is SequenceKey {
  return typeof v === "string" && (SEQUENCE_KEYS as readonly string[]).includes(v);
}

/** When a step is due.
 *  - after: minutes after the base. No reply: after our last message (or the
 *    previous step). Before the call: after the booking. No-show: after the
 *    call ended (step 1) or the previous step.
 *  - day_before / day_of: a clock time ("17:00") in the LEAD's timezone.
 *  - before_call: minutes before the call starts. */
export type StepTiming =
  | { kind: "after"; minutes: number }
  | { kind: "day_before"; time: string }
  | { kind: "day_of"; time: string }
  | { kind: "before_call"; minutes: number };

export interface SequenceStep {
  /** Stable id: queued steps and the history point at it. */
  id: string;
  label: string;
  timing: StepTiming;
  /** What J should do in this message (J writes it in the setter's voice). */
  intent: string;
  /** Send exactly this instead of letting J write. Blank = J writes. */
  fixedLine: string;
  /** Voice-note hook: the phrase of a recorded clip to send instead of the
   *  text when it matches (the voice bank, built separately). Blank = text. */
  voicePhrase: string;
  /** Nurture: attach one matching resource this setter has switched on that
   *  they haven't had yet. Skipped when none is left. */
  resource: boolean;
}

export interface Sequence {
  key: SequenceKey;
  enabled: boolean;
  steps: SequenceStep[];
}

export type SequenceSet = Record<SequenceKey, Sequence>;

export interface SequenceMeta {
  key: SequenceKey;
  group: "no_reply" | "booked" | "after_call";
  title: string;
  /** One line for the settings screen. */
  blurb: string;
  /** Which timing kinds the editor offers. */
  timings: StepTiming["kind"][];
}

export const SEQUENCE_META: Record<SequenceKey, SequenceMeta> = {
  no_reply_lead: {
    key: "no_reply_lead",
    group: "no_reply",
    title: "Lead, early chat",
    blurb: "They answered the opener, then went quiet.",
    timings: ["after"],
  },
  no_reply_qualifying: {
    key: "no_reply_qualifying",
    group: "no_reply",
    title: "Qualifying",
    blurb: "Quiet in the middle of J's questions.",
    timings: ["after"],
  },
  no_reply_value: {
    key: "no_reply_value",
    group: "no_reply",
    title: "After value sent",
    blurb: "They got a resource and didn't come back.",
    timings: ["after"],
  },
  no_reply_invite: {
    key: "no_reply_invite",
    group: "no_reply",
    title: "After the invite",
    blurb: "J offered a call (or times) and heard nothing.",
    timings: ["after"],
  },
  pre_call: {
    key: "pre_call",
    group: "booked",
    title: "Booked, before the call",
    blurb: "The confirmation goes out when J books. Then a nurture piece and two reminders, in their timezone.",
    timings: ["after", "day_before", "day_of", "before_call"],
  },
  no_show: {
    key: "no_show",
    group: "after_call",
    title: "No-show",
    blurb: "They missed the call. Warm and human, then an offer to find another time. Stops when they reply.",
    timings: ["after"],
  },
  showed: {
    key: "showed",
    group: "after_call",
    title: "Showed",
    blurb: "Nothing automated. You get a task to send them a personal voice note, with their goal and pain from the thread.",
    timings: [],
  },
};

const HOUR = 60;
const DAY = 24 * HOUR;

function step(id: string, label: string, timing: StepTiming, intent: string, extra: Partial<SequenceStep> = {}): SequenceStep {
  return { id, label, timing, intent, fixedLine: "", voicePhrase: "", resource: false, ...extra };
}

/** Value → social proof → direct ask → breakup, with the delays fitted inside
 *  Meta's 7-day HUMAN_AGENT window (their last message + 7 days). */
function noReplySteps(context: string): SequenceStep[] {
  return [
    step(
      "value",
      "Value first",
      { kind: "after", minutes: 20 * HOUR },
      `${context} Give them something useful tied to what THEY said (a tip, an idea, a resource if one fits). No question needed, no pitch, no "just checking in".`
    ),
    step(
      "proof",
      "Social proof",
      { kind: "after", minutes: 2 * DAY },
      "Share a short, true result from someone like them, if the BRAND CONTEXT has one (never invent a result or a name). Light, a story not a pitch. If nothing true fits, hold."
    ),
    step(
      "ask",
      "Direct ask",
      { kind: "after", minutes: 2 * DAY },
      "One clear, low-pressure question about where they're at with what they told you. Easy to answer in a word."
    ),
    step(
      "breakup",
      "Breakup",
      { kind: "after", minutes: 2 * DAY },
      "A warm breakup: no guilt, the door left open. e.g. \"haven't heard back so I'll leave it here, if things change just shout\". Then J stops.",
      {}
    ),
  ];
}

export function defaultSequence(key: SequenceKey): Sequence {
  switch (key) {
    case "no_reply_lead":
      return { key, enabled: true, steps: noReplySteps("They answered the opener and went quiet.") };
    case "no_reply_qualifying":
      return { key, enabled: true, steps: noReplySteps("They went quiet while you were getting to know their situation. Don't repeat the last question.") };
    case "no_reply_value":
      return { key, enabled: true, steps: noReplySteps("They got a resource from you and went quiet. Reference it lightly; don't ask if they watched it.") };
    case "no_reply_invite":
      return { key, enabled: true, steps: noReplySteps("You offered a call (or times) and heard nothing. Don't re-pitch the call in step 1.") };
    case "pre_call":
      return {
        key,
        enabled: true,
        steps: [
          step(
            "nurture-1",
            "Nurture",
            { kind: "after", minutes: 2 * HOUR },
            "Share one resource that fits their goal, so the call starts warm. One line on why it made you think of them. No ask.",
            { resource: true }
          ),
          step(
            "nurture-2",
            "Second nurture",
            { kind: "after", minutes: 26 * HOUR },
            "Only if the call is a few days away: one more piece that matches what they said. Skip the pitch.",
            { resource: true }
          ),
          step(
            "day-before",
            "Day before",
            { kind: "day_before", time: "17:00" },
            "A one-line check that tomorrow still works.",
            { fixedLine: "still good for tomorrow?" }
          ),
          step(
            "day-of",
            "On the day",
            { kind: "before_call", minutes: 2 * HOUR },
            "Short and warm: looking forward to it in a bit. Mention the time in their timezone. No new info."
          ),
        ],
      };
    case "no_show":
      return {
        key,
        enabled: true,
        steps: [
          step(
            "check-in",
            "Check in",
            { kind: "after", minutes: 30 },
            "They missed the call. Human and warm, zero guilt: hope all's ok, things come up. No re-book ask yet."
          ),
          step(
            "rebook",
            "Offer another time",
            { kind: "after", minutes: DAY },
            "Offer to find another time, easy and no pressure. If they say yes, J offers real times in the DM (the booking flow)."
          ),
          step(
            "last",
            "Leave the door open",
            { kind: "after", minutes: 3 * DAY },
            "Something personal: a thought on what they told you they want, or a resource that fits. Leave the door open. Then J stops."
          ),
        ],
      };
    case "showed":
      return { key, enabled: true, steps: [] };
  }
}

export function defaultSequenceSet(): SequenceSet {
  return Object.fromEntries(SEQUENCE_KEYS.map((k) => [k, defaultSequence(k)])) as SequenceSet;
}

// ---------------------------------------------------------------- cleaning
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_STEPS = 8;
const MAX_MINUTES = 30 * DAY;

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function cleanTiming(raw: unknown, allowed: StepTiming["kind"][]): StepTiming {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = allowed.includes(t.kind as StepTiming["kind"]) ? (t.kind as StepTiming["kind"]) : (allowed[0] ?? "after");
  if (kind === "day_before" || kind === "day_of") {
    const time = typeof t.time === "string" && TIME_RE.test(t.time) ? t.time : kind === "day_before" ? "17:00" : "09:00";
    return { kind, time };
  }
  const n = Number(t.minutes);
  const minutes = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), kind === "before_call" ? 5 : 10), MAX_MINUTES) : 60;
  return { kind, minutes };
}

/** A sequence as the editor (or the DB) sends it, made safe. */
export function cleanSequence(key: SequenceKey, raw: unknown): Sequence {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const meta = SEQUENCE_META[key];
  const fallback = defaultSequence(key);
  const list = Array.isArray(r.steps) ? r.steps : fallback.steps;
  const seen = new Set<string>();
  const steps = meta.timings.length
    ? list.slice(0, MAX_STEPS).map((s, i): SequenceStep => {
        const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
        let id = cleanText(x.id, 40).replace(/[^a-z0-9-]/gi, "").toLowerCase() || `step-${i + 1}`;
        while (seen.has(id)) id = `${id}-${i + 1}`;
        seen.add(id);
        return {
          id,
          label: cleanText(x.label, 60) || `Step ${i + 1}`,
          timing: cleanTiming(x.timing, meta.timings),
          intent: cleanText(x.intent, 1000),
          fixedLine: cleanText(x.fixedLine, 1000),
          voicePhrase: cleanText(x.voicePhrase, 200),
          resource: x.resource === true,
        };
      })
    : [];
  return { key, enabled: typeof r.enabled === "boolean" ? r.enabled : fallback.enabled, steps };
}

/** The setter's sequences: stored rows over the defaults. */
export function resolveSequenceSet(rows: { key: string; enabled: boolean; steps: unknown }[]): SequenceSet {
  const set = defaultSequenceSet();
  for (const row of rows) {
    if (!isSequenceKey(row.key)) continue;
    set[row.key] = cleanSequence(row.key, { enabled: row.enabled, steps: row.steps });
  }
  return set;
}

/** "in 20h", "2 days", "30 min" for the editor and the queue. */
export function timingLabel(t: StepTiming): string {
  const dur = (m: number) => (m % DAY === 0 ? `${m / DAY} ${m / DAY === 1 ? "day" : "days"}` : m % HOUR === 0 ? `${m / HOUR}h` : `${m} min`);
  switch (t.kind) {
    case "after":
      return `after ${dur(t.minutes)}`;
    case "day_before":
      return `day before, ${t.time}`;
    case "day_of":
      return `on the day, ${t.time}`;
    case "before_call":
      return `${dur(t.minutes)} before`;
  }
}
