// "Test this setter" (spec item 15): you play the lead, J answers with the
// real method, the setter's knowledge and the real drafter backend. Nothing
// here reads or writes Instagram, a Contact, a Draft or J's state: the
// transcript lives in the browser and is passed in whole on every turn.

import { getSetterConfig } from "@/lib/os/setter/config";
import { draft as runDrafter, type DraftUsage } from "@/lib/os/setter/drafter";
import type { ResolvedSetter } from "@/lib/os/setter/kb";
import { loadMethod } from "@/lib/os/setter/knowledge";
import { bubblesOf, buildPrompt, isInvitation, mentionsPrice, systemPrompt, type DraftObject } from "@/lib/os/setter/prompt";
import { advance, newRecord, observe, type SetterAction, type ThreadMessage } from "@/lib/os/setter/state";

export interface SandboxTurn {
  from: "lead" | "setter";
  text: string;
}

export interface SandboxOptions {
  /** Pretend they came in through this catalog row (its opener goes first). */
  entrySlug?: string | null;
  handle?: string;
  now?: Date;
}

export interface SandboxReply {
  bubbles: string[];
  hold: boolean;
  holdReason: string | null;
  stage: string | null;
  reasoning: string | null;
  flags: string[];
  usage: DraftUsage;
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
