// "Test this setter" (spec item 15): you play the lead, J answers with the
// real method, the setter's knowledge and the real drafter backend. Nothing
// here reads or writes Instagram, a Contact, a Draft or J's state: the
// transcript lives in the browser and is passed in whole on every turn.

import { calendarSource, type CalendarSource } from "@/lib/os/setter/booking-store";
import { agentBackend, runAgentTurn, type AgentBackend, type DraftTrace } from "@/lib/os/setter/agent";
import { bookingStateBlock, toolsBrief } from "@/lib/os/setter/agent/brief";
import { usableCalendar } from "@/lib/os/setter/agent/context";
import type { ActiveCalendar } from "@/lib/os/integrations/calendar/store";
import { getSetterConfig } from "@/lib/os/setter/config";
import { draft as runDrafter, type DraftUsage } from "@/lib/os/setter/drafter";
import type { ResolvedSetter } from "@/lib/os/setter/kb";
import { loadMethod } from "@/lib/os/setter/knowledge";
import { bubblesOf, buildPrompt, isInvitation, mentionsPrice, systemPrompt, type DraftObject } from "@/lib/os/setter/prompt";
import { advance, newRecord, observe, type SetterAction, type SetterRecord, type ThreadMessage } from "@/lib/os/setter/state";

export interface SandboxTurn {
  from: "lead" | "setter";
  text: string;
}

export interface SandboxOptions {
  /** Pretend they came in through this catalog row (its opener goes first). */
  entrySlug?: string | null;
  handle?: string;
  now?: Date;
  /** J with tools (OS_J_TOOLS=1): the workspace, so check_calendar reads the
   *  setter's real calendar. Without it the sandbox has no calendar tools. */
  workspaceId?: string | null;
  /** Override the calendar (tests). */
  calendar?: CalendarSource;
  /** Override the tool-loop model backend (tests). */
  agent?: AgentBackend | null;
}

export interface SandboxReply {
  bubbles: string[];
  hold: boolean;
  holdReason: string | null;
  stage: string | null;
  reasoning: string | null;
  flags: string[];
  usage: DraftUsage;
  /** J with tools: what he saw and did. Actions are recorded here, never run. */
  trace?: DraftTrace;
}

/** The opener OpenReply/Zernio would have sent for an entry row. */
export function entryOpener(setter: ResolvedSetter, slug: string | null | undefined): string | null {
  if (!slug) return null;
  const row = setter.catalog.resources.find((r) => r.slug === slug);
  if (!row) return null;
  return row.opener?.message || row.zernio?.dm_message || row.dm?.message || null;
}

/** The sandbox transcript as J's thread: one message per turn, a minute apart, ending now. */
export function sandboxThread(turns: SandboxTurn[], opener: string | null, now: Date): ThreadMessage[] {
  const all: SandboxTurn[] = [...(opener ? [{ from: "setter" as const, text: opener }] : []), ...turns].filter((t) => t.text.trim());
  return all.map((t, i) => ({
    id: `sandbox-${i + 1}`,
    text: t.text.trim(),
    incoming: t.from === "lead",
    at: new Date(now.getTime() - (all.length - 1 - i) * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  }));
}

export async function sandboxReply(setter: ResolvedSetter, turns: SandboxTurn[], opts: SandboxOptions = {}): Promise<SandboxReply> {
  const cfg = getSetterConfig();
  const now = opts.now ?? new Date();
  const msgs = sandboxThread(turns, entryOpener(setter, opts.entrySlug), now);
  if (!msgs.some((m) => m.incoming)) throw new Error("Write something as the lead first.");

  let rec = newRecord("sandbox", opts.handle ?? "lead");
  rec = observe(rec, msgs, [], setter.catalog.resources, now, cfg);
  [rec] = advance(rec, now, cfg);
  const last = msgs[msgs.length - 1];
  const action: SetterAction = { kind: last.incoming ? "reply" : "nudge", anchor: `sandbox:${last.id}`, human_agent: false };

  const today = now.toISOString().slice(0, 10);
  const system = systemPrompt(loadMethod(), setter.profile, setter.offered, today);
  const tools = agentBackend(cfg.drafter.backend, opts.agent);
  if (tools) return sandboxToolTurn(setter, tools, { rec, msgs, action, now, system, workspaceId: opts.workspaceId ?? null, calendar: opts.calendar });
  const prompt = buildPrompt(rec, msgs, action, setter.catalog, now);
  const result = await runDrafter({ system, prompt, job: "draft", settings: cfg.drafter });
  const obj = (result.obj && typeof result.obj === "object" ? result.obj : {}) as DraftObject;
  const bubbles = bubblesOf(obj);
  const hold = Boolean(obj.hold) || !bubbles.length;
  const flags: string[] = [];
  if (!hold && isInvitation(obj, rec)) flags.push("invite");
  if (!hold && mentionsPrice(bubbles)) flags.push("price");
  if (result.usage.backend === "fake") flags.push("sample");
  return {
    bubbles: hold ? [] : bubbles,
    hold,
    holdReason: hold ? obj.hold_reason || "no reply needed" : null,
    stage: obj.stage_proposed || obj.stage || null,
    reasoning: obj.stage_reasoning || obj.reasoning || null,
    flags,
    usage: result.usage,
  };
}

/** The sandbox turn with tools: reads are real (or fake), actions are only
 *  recorded in the trace. Nothing is booked, sent, saved or synced. */
async function sandboxToolTurn(
  setter: ResolvedSetter,
  backend: AgentBackend,
  o: { rec: SetterRecord; msgs: ThreadMessage[]; action: SetterAction; now: Date; system: string; workspaceId: string | null; calendar?: CalendarSource }
): Promise<SandboxReply> {
  const cfg = getSetterConfig();
  let cal: ActiveCalendar | null = null;
  if (o.workspaceId) {
    try {
      cal = usableCalendar(await (o.calendar ?? calendarSource).forSetter(o.workspaceId, setter.setterId));
    } catch (err) {
      console.error("[OS Sandbox] calendar read failed:", err instanceof Error ? err.message : err);
    }
  }
  const extras = [bookingStateBlock(cal, o.rec)].filter(Boolean);
  const prompt = buildPrompt(o.rec, o.msgs, o.action, setter.catalog, o.now, extras, toolsBrief({ calendar: Boolean(cal), fields: Boolean(setter.profile.fields?.length) }));
  const turn = await runAgentTurn({
    system: o.system,
    prompt,
    backend,
    settings: cfg.drafter,
    env: {
      now: o.now,
      contact: { id: null, username: o.rec.handle, fullName: null, email: null, tags: [], stage: null, setterStage: null, paused: false },
      rec: o.rec,
      msgs: o.msgs,
      setter,
      windowClosed: false,
      calendar: cal,
      lines: [],
      dry: true,
    },
  });
  const obj = turn.obj;
  const bubbles = [...bubblesOf(obj), ...turn.resourceBubbles];
  const hold = Boolean(obj.hold) || !bubbles.length;
  const flags = [...turn.flags];
  if (!hold && isInvitation(obj, o.rec)) flags.push("invite");
  if (!hold && mentionsPrice(bubbles)) flags.push("price");
  if (turn.usage.backend === "fake") flags.push("sample");
  return {
    bubbles: hold ? [] : bubbles,
    hold,
    holdReason: hold ? String(obj.hold_reason || "no reply needed") : null,
    stage: obj.stage_proposed || null,
    reasoning: obj.stage_reasoning || null,
    flags,
    usage: turn.usage,
    trace: turn.trace,
  };
}
