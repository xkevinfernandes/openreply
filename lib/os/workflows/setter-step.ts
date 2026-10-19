// The Setter step's rules, pure: when J releases the held resource (R1–R5),
// the quiet timer (R2 at a random 18–22h, inside the window), the one
// second-resource nudge (Q1), and the step as J sees it (get_step).
// Spec §2 of 2026-10-19-workflows-spec.md.

import type { StepData } from "@/lib/os/workflows/graph";
import type { Classification, PendingDirective, ReleaseRule, SetterRunState } from "@/lib/os/workflows/types";

export type SetterData = StepData<"setter">;

/** Instagram: free sends until 24h after their last message. */
export const FREE_WINDOW_MS = 24 * 3600_000;
/** HUMAN_AGENT (approve-only) until 7 days after their last message. */
export const HUMAN_AGENT_MS = 7 * 24 * 3600_000;
/** Never schedule a timed send closer than this to the window closing. */
export const WINDOW_SAFETY_MS = 60 * 60_000;

export function newSetterState(nodeId: string, data: SetterData): SetterRunState {
  return {
    nodeId,
    held: data.leadMagnet.mode === "hold" ? [...data.leadMagnet.resources] : [],
    released: [],
    asks: 0,
    lowEffort: 0,
    replies: 0,
    goal: data.goal,
    releaseRule: null,
    directive: null,
    nudged: false,
    notes: [],
    quietAt: null,
    quietFrom: null,
  };
}

/** Resources still held (not yet out). */
export function stillHeld(s: SetterRunState): string[] {
  return s.held.filter((x) => !s.released.includes(x));
}

// ---------------------------------------------------------------- classifier
const ONE_WORD = /^(ok(ay)?|k|kk|cool|nice|yes|yeah|yep|ya|sure|thanks|thx|ty|great|lol|haha+|hm+|sounds good|awesome|perfect|nope|no|maybe|idk|👍|🙏|🔥|❤️|💯)[.!?\s]*$/i;
const SEND_IT = /\b(just\s+)?(send|drop|share|give)\s+(it|me\s+it|the\s+(link|guide|thing|resource|pdf))\b|\bwhere('?s| is)\s+(the\s+)?(link|guide|resource)|\bcan i (get|have) (it|the (link|guide))|\b(link|guide)\s*(pls|please|plz)\b|\bsend (pls|please|plz)\b/i;
const JUST_SEND = /\bjust\s+(send|drop|give)\b|\bnot (ready|interested in a call)\b|\bno call\b/i;
const NOT_FIT = /\b(i'?m (just )?a student|not a creator|don'?t have a business|no business|just curious|i'?m 1[3-7]\b|still in (high )?school)\b/i;
const STOP = /\b(stop|unsubscribe|leave me alone|f+u+c*k+ off|piss off|don'?t (message|dm|text) me|not interested|spam)\b/i;
const AI_Q = /\b(are you|is this|you'?re) (a |an )?(bot|ai|robot|automated|real person|human)\b|\bchat ?gpt\b/i;

/** The cheap rules: what the Haiku classifier falls back to (and the fake backend). */
export function heuristicClassify(text: string): Classification {
  const t = (text ?? "").trim();
  const words = t.split(/\s+/).filter(Boolean);
  return {
    lowEffort: !t || ONE_WORD.test(t) || (words.length <= 1 && t.length <= 8 && !/[?]/.test(t)),
    askedForResource: SEND_IT.test(t),
    notReady: JUST_SEND.test(t),
    notFit: NOT_FIT.test(t),
    stop: STOP.test(t),
    aiQuestion: AI_Q.test(t),
  };
}

export const CLASSIFY_SYSTEM =
  "You label one Instagram DM reply for a sales setter. Answer with JSON only: " +
  '{"lowEffort":bool,"askedForResource":bool,"notReady":bool,"notFit":bool,"stop":bool,"aiQuestion":bool}. ' +
  "lowEffort: a one-word or low-effort reply (ok, cool, yes, an emoji). askedForResource: they directly ask for the resource/link/guide. " +
  'notReady: they say "just send it" or that they don\'t want a conversation/call now. notFit: not a creator, no business, a student. ' +
  "stop: stop, unsubscribe, not interested, or rude. aiQuestion: they ask if this is a bot/AI.";

export function readClassification(obj: unknown, fallback: Classification): Classification {
  if (!obj || typeof obj !== "object") return fallback;
  const o = obj as Record<string, unknown>;
  const b = (k: keyof Classification) => (typeof o[k] === "boolean" ? (o[k] as boolean) : fallback[k]);
  return { lowEffort: b("lowEffort"), askedForResource: b("askedForResource"), notReady: b("notReady"), notFit: b("notFit"), stop: b("stop"), aiQuestion: b("aiQuestion") };
}

// ---------------------------------------------------------------- release rules
export type SetterSignal =
  | { kind: "reply"; c: Classification }
  /** They commented the same keyword again (E3): counts as asking. */
  | { kind: "repeat_keyword" }
  | { kind: "booked" }
  | { kind: "not_fit" };

export interface SignalOutcome {
  state: SetterRunState;
  /** Release now by this rule (J writes the message). */
  release: ReleaseRule | null;
  /** Leave the step by this exit. */
  exit: "stopped" | "goal_met" | "booked" | null;
}

/**
 * Fold one signal into the step's state and decide. The first rule that
 * fires wins; a release only happens while something is held and its rule is
 * switched on. After a release J stays in the step (the goal is still the
 * call) unless R3 / R5 moved it to Start a conversation.
 */
export function onSignal(prev: SetterRunState, data: SetterData, sig: SetterSignal): SignalOutcome {
  const s: SetterRunState = { ...prev, notes: [...prev.notes] };
  const held = stillHeld(s).length > 0 && !s.directive;
  const out = (release: ReleaseRule | null, exit: SignalOutcome["exit"] = null): SignalOutcome => {
    if (release) {
      s.releaseRule = release;
      if (release === "R3" || release === "R5") s.goal = "start_conversation";
    }
    return { state: s, release, exit };
  };
  switch (sig.kind) {
    case "booked":
      return out(held && data.release.booked ? "R1" : null, "booked");
    case "not_fit":
      s.notFit = true;
      return out(held && data.release.notFit ? "R5" : null);
    case "repeat_keyword": {
      s.asks += 1;
      s.notes.push("commented the keyword again");
      return out(held && data.release.askedTwice && s.asks >= 2 ? "R4" : null);
    }
    case "reply": {
      const c = sig.c;
      if (c.stop) return out(null, "stopped");
      s.replies += c.lowEffort ? 0 : 1;
      s.lowEffort = c.lowEffort ? s.lowEffort + 1 : 0;
      // "just send it" is them asking: the first time J keeps it light (J2).
      if (c.askedForResource || c.notReady) s.asks += 1;
      if (c.aiQuestion) s.notes.push("asked if this is a bot: never claim to be human, deflect lightly and hand to Kevin");
      if (c.notFit) s.notFit = true;
      let rule: ReleaseRule | null = null;
      if (held) {
        // R3: two low-effort replies in a row, or "just send it / no call" asked
        // again (they're not ready: release and back off). R4: a plain second ask.
        if (data.release.notFit && c.notFit) rule = "R5";
        else if (data.release.notReady && (s.lowEffort >= 2 || (c.notReady && s.asks >= 2))) rule = "R3";
        else if (data.release.askedTwice && s.asks >= 2) rule = "R4";
      } else if (c.notFit && s.goal === "book_call") {
        // Nothing to release, but still no call push for someone off-path.
        s.goal = "start_conversation";
      }
      const res = out(rule);
      // Start a conversation: real engagement = 2 real replies.
      if (!res.release && s.goal === "start_conversation" && data.goal === "start_conversation" && s.replies >= 2) return { ...res, exit: "goal_met" };
      return res;
    }
  }
}

/** A directive for J: release these, or offer the second resource. */
export function directive(kind: PendingDirective["kind"], rule: ReleaseRule | null, slugs: string[], now: Date): PendingDirective {
  return { kind, rule, slugs, at: now.toISOString() };
}

// ---------------------------------------------------------------- timers
/**
 * When the quiet release (R2) goes: a random 18–22h after their last message,
 * never past the free window minus the safety margin. Null when there's no
 * time left in the window.
 */
export function quietReleaseAt(theirLastAt: Date, hours: [number, number], random: () => number): Date | null {
  const [lo, hi] = hours[0] <= hours[1] ? hours : [hours[1], hours[0]];
  const at = theirLastAt.getTime() + (lo + random() * (hi - lo)) * 3600_000;
  const latest = theirLastAt.getTime() + FREE_WINDOW_MS - WINDOW_SAFETY_MS;
  const t = Math.min(at, latest);
  return t > theirLastAt.getTime() ? new Date(t) : null;
}

export function windowOf(theirLastAt: Date | null, now: Date): "free" | "human_agent" | "closed" {
  if (!theirLastAt) return "closed";
  const age = now.getTime() - theirLastAt.getTime();
  if (age < FREE_WINDOW_MS) return "free";
  if (age < HUMAN_AGENT_MS) return "human_agent";
  return "closed";
}

export type SetterTimerPlan =
  | { kind: "quiet_release"; at: Date }
  | { kind: "nudge"; at: Date }
  | { kind: "quiet_exit"; at: Date }
  | { kind: "none" };

/**
 * The next timer of a Setter step, from the state and the thread. Only while
 * we wrote last (they owe us a reply): a held resource gets the R2 release,
 * otherwise one second-resource nudge (Q1, if set and unused), and once the
 * free window has closed with no reply the step leaves by Quiet.
 */
export function nextSetterTimer(
  s: SetterRunState,
  data: SetterData,
  t: { theirLastAt: Date | null; weWroteLast: boolean; now: Date; pendingDraft: boolean },
  random: () => number
): SetterTimerPlan {
  if (!t.theirLastAt) return { kind: "none" };
  const close = new Date(t.theirLastAt.getTime() + FREE_WINDOW_MS);
  // A J draft waits for Approve: under HUMAN_AGENT it may still go until day 7.
  const hardClose = new Date(t.theirLastAt.getTime() + (t.pendingDraft ? HUMAN_AGENT_MS : FREE_WINDOW_MS));
  if (s.directive) return { kind: "quiet_exit", at: hardClose };
  const held = stillHeld(s);
  // Chosen once per silence (kept while their last message is the same); a
  // time already past still goes now, as long as the window is open.
  const quietTime = (): Date | null => {
    const fromKey = t.theirLastAt!.toISOString();
    if (s.quietFrom === fromKey && s.quietAt) return new Date(s.quietAt);
    const at = quietReleaseAt(t.theirLastAt!, data.quietHours, random);
    if (!at) return null;
    if (at > t.now) return at;
    return t.now.getTime() < close.getTime() - WINDOW_SAFETY_MS ? t.now : null;
  };
  if (held.length && t.weWroteLast && data.leadMagnet.mode === "hold" && data.release.quiet) {
    const at = quietTime();
    if (at) return { kind: "quiet_release", at };
  }
  if (t.weWroteLast && !held.length && data.leadMagnet.second && !s.nudged && !s.released.includes(data.leadMagnet.second) && s.releaseRule !== "R2") {
    const at = quietTime();
    if (at) return { kind: "nudge", at };
  }
  return { kind: "quiet_exit", at: t.pendingDraft ? hardClose : close };
}

// ---------------------------------------------------------------- J's view
export interface WorkflowStepView {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeId: string;
  mode: "draft" | "auto";
  goal: "book_call" | "start_conversation";
  leadMagnet: { mode: "hold" | "send_first" | "none"; resources: { slug: string; title: string; released: boolean }[] };
  releaseRules: { id: string; when: string }[];
  exits: string[];
  /** Release now / offer the second resource: J writes it, the link goes in its own bubble. */
  directive: PendingDirective | null;
  notes: string[];
  /** Link bubbles the server adds when J's draft carries the directive. */
  directiveLinks: { slug: string; url: string }[];
  /** Still held (not released): send_resource refuses these until a rule fires. */
  held: string[];
  /** The step's resources J may send (send_resource), with their links. */
  sendable: { slug: string; title: string; url: string }[];
}

const RULE_TEXT: Record<ReleaseRule, string> = {
  R1: 'they booked: "by the way, here\'s the guide, completely forgot to send it"',
  R2: 'quiet ~20h after we wrote: "oh sorry, thought I\'d already sent this, here you go"',
  R3: "not ready (two low-effort replies, or 'just send it'): send it and wish them well, then low pressure",
  R4: "they asked for it a second time: send it, no friction",
  R5: "not a fit (not a creator / no business / student): send it with a warm close, no call push",
};

export function releaseRulesView(data: SetterData): { id: string; when: string }[] {
  if (data.leadMagnet.mode !== "hold") return [];
  const on: [ReleaseRule, boolean][] = [
    ["R1", data.release.booked],
    ["R2", data.release.quiet],
    ["R3", data.release.notReady],
    ["R4", data.release.askedTwice],
    ["R5", data.release.notFit],
  ];
  return on.filter(([, v]) => v).map(([id]) => ({ id, when: RULE_TEXT[id] }));
}

/** The prompt block for the legacy (no tools) path and the tool brief. */
export function stepBlock(v: WorkflowStepView): string {
  const lines = [`WORKFLOW STEP (${v.workflowName}): goal = ${v.goal === "book_call" ? "book a call" : "start a conversation (2 real replies, no call push)"}.`];
  const res = v.leadMagnet.resources;
  if (v.leadMagnet.mode === "hold" && res.some((r) => !r.released))
    lines.push(
      `You are HOLDING ${res
        .filter((r) => !r.released)
        .map((r) => r.title)
        .join(", ")}. Don't send it yet: the server releases it by rule. If they ask the first time, keep it light and give the question a reason ("sending it now, quick q so I send the right version…").`
    );
  if (v.leadMagnet.mode === "send_first") lines.push("The resource was sent first: now start the conversation with one easy question.");
  if (v.directive?.kind === "release")
    lines.push(
      `RELEASE NOW (${v.directive.rule ?? "rule"}): send ${v.directive.slugs.join(", ")} in this message, written fresh in Kevin's voice (${v.directive.rule ? RULE_TEXT[v.directive.rule] : "send it"}). The link goes in its own bubble (send_resource; never type the URL).`
    );
  if (v.directive?.kind === "nudge") lines.push(`ONE NUDGE: offer the second resource once, Laura-style ("if you want I can send you ${v.directive.slugs.join(", ")} too"). Low pressure.`);
  for (const n of v.notes.slice(-4)) lines.push(`Note: ${n}.`);
  return lines.join("\n");
}
