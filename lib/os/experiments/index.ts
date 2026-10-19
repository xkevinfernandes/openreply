// A/B testing at send time. Two callers:
//  - OpenReply's DM worker (one hook): campaignOpenerText picks the opening DM.
//  - J (lib/os/setter/service.ts): linesForDraft puts the assigned lines in
//    the prompt (and get_step), tagsFor records which ones the draft carries,
//    and recordSent attributes them once the message actually goes out.
// A J line is assigned the first time it goes out to that person (recordSent
// writes the Assignment). Until then the pick is a stable hash of the person,
// so every draft before that offers them the same variant.
// Nothing here may break a send: every entry point swallows its errors and
// falls back to the original text / no lines.

import { fillName, keepOrPick, pickVariant } from "@/lib/os/experiments/assign";
import { editedHeavily, lineUsed } from "@/lib/os/experiments/similarity";
import { experimentStore, type ExperimentStore, type Person } from "@/lib/os/experiments/store";
import { recordSend } from "@/lib/os/sending/cap";
import { LINE_KEYS, parseSlot, readAbTags, scopedSlot, slotOf, type AbTag, type ExperimentLite, type LineKey, type VariantLite } from "@/lib/os/experiments/types";

let warned = false;
function warn(where: string, err: unknown) {
  if (warned && process.env.NODE_ENV === "test") return;
  warned = true;
  console.error(`[OS Experiments] ${where}:`, err instanceof Error ? err.message : err);
}

async function assignFor(store: ExperimentStore, exp: ExperimentLite, p: Person, random: () => number): Promise<VariantLite | null> {
  const existing = await store.findAssignment(exp.id, p);
  const { variant, isNew } = keepOrPick(existing?.variantId, exp.variants, exp.allocation, random());
  if (!variant) return null;
  if (!isNew) return variant;
  const row = await store.createAssignment(exp.id, variant.id, p);
  // Lost a race: the other call's pick wins, so the person still has one variant.
  return exp.variants.find((v) => v.id === row.variantId) ?? variant;
}

// ---------------------------------------------------------------- campaign hook
export interface CampaignOpenerInput {
  workspaceId: string;
  automationId: string;
  /** Our InstagramAccount.id. */
  instagramAccountId: string;
  /** The commenter's Instagram-scoped id. */
  igUserId: string;
  /** The campaign's own opening DM, returned when no experiment runs. */
  original: string;
  store?: ExperimentStore;
  random?: () => number;
}

/** The opening DM this person gets: their variant when an experiment runs on
 *  this campaign, else the original. The worker renders it as usual
 *  ({username} etc.), and records the send in DmLog, which is how the send
 *  is attributed (lib/os/experiments/data.ts). */
export async function campaignOpenerText(input: CampaignOpenerInput): Promise<string> {
  // The opener is about to go out: it counts toward today's send cap
  // (lib/os/sending/cap.ts). Counted, never blocked: OpenReply owns this send.
  if (!input.store) await recordSend(input.workspaceId, { key: `opener:${input.automationId}:${input.igUserId}`, source: "campaign_opener" });
  try {
    const store = input.store ?? experimentStore();
    const [exp] = await store.running(input.workspaceId, [slotOf("campaign_opener", input.automationId)]);
    if (!exp) return input.original;
    const v = await assignFor(store, exp, input, input.random ?? Math.random);
    return v?.text.trim() ? v.text : input.original;
  } catch (err) {
    warn("campaign opener", err);
    return input.original;
  }
}

// ---------------------------------------------------------------- J
export interface OfferedLine {
  experimentId: string;
  variantId: string;
  slot: string;
  /** "opener" or a line key; what J reports back in lines_used. */
  key: string;
  text: string;
  /** This draft IS that line (the opener, follow-up 1): no "if" about it. */
  forced: boolean;
}

export interface LinesInput {
  workspaceId: string;
  setterId: string | null;
  /** The workflow J is running in (its tests beat setter-wide ones). */
  workflowId?: string | null;
  person: Person;
  name: string | null;
  /** rec.entry.via, for j_opener slots. */
  entry: string | null;
  /** The draft kind J is writing: reply | value_opener | nudge… */
  actionKind: string;
  /** J hasn't sent anything to them yet. */
  firstMessage: boolean;
  nudgesSoFar: number;
  alreadyInvited: boolean;
  store?: ExperimentStore;
  /** Tests: replaces the stable per-person pick. */
  random?: () => number;
}

/** The slots that apply to this draft, most specific first per kind. */
export function candidateSlots(i: Pick<LinesInput, "entry" | "actionKind" | "firstMessage" | "nudgesSoFar" | "alreadyInvited">): string[] {
  const slots: string[] = [];
  if (i.firstMessage || i.actionKind === "value_opener") {
    if (i.entry) slots.push(slotOf("j_opener", i.entry));
    slots.push(slotOf("j_opener", "any"));
  } else {
    slots.push(slotOf("line", "permission_ask"), slotOf("line", "qualifying"), slotOf("line", "value_offer"));
    if (!i.alreadyInvited) slots.push(slotOf("line", "invite"));
  }
  if (i.actionKind === "nudge" && i.nudgesSoFar === 0) slots.push(slotOf("line", "follow_up_1"));
  return slots;
}

/** The test that runs on this line for this setter and workflow, if any:
 *  this workflow's test beats a setter-wide one, and a test for this setter
 *  beats one for every setter. */
export function testFor<T extends Pick<ExperimentLite, "slot" | "setterId">>(running: T[], base: string, setterId: string | null, workflowId?: string | null): T | null {
  const ok = running.filter((e) => !e.setterId || e.setterId === setterId);
  const order = workflowId ? [scopedSlot(base, workflowId), base] : [base];
  for (const slot of order) {
    const hits = ok.filter((e) => e.slot === slot);
    const best = hits.find((e) => e.setterId === setterId) ?? hits[0];
    if (best) return best;
  }
  return null;
}

/** A stable number in [0, 1) per person and test: the same pick every draft. */
export function stableUnit(experimentId: string, p: Pick<Person, "instagramAccountId" | "igUserId">): number {
  let h = 0x811c9dc5;
  for (const ch of `${experimentId}:${p.instagramAccountId}:${p.igUserId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

export async function linesForDraft(i: LinesInput): Promise<OfferedLine[]> {
  try {
    const store = i.store ?? experimentStore();
    const bases = candidateSlots(i);
    const slots = bases.flatMap((b) => (i.workflowId ? [scopedSlot(b, i.workflowId), b] : [b]));
    const running = await store.running(i.workspaceId, slots);
    const out: OfferedLine[] = [];
    let opener = false;
    for (const base of bases) {
      const exp = testFor(running, base, i.setterId, i.workflowId);
      if (!exp) continue;
      const parsed = parseSlot(base);
      if (!parsed) continue;
      const isOpener = parsed.kind === "j_opener";
      if (isOpener && opener) continue; // the specific entry beat "any"
      const done = await store.findAssignment(exp.id, i.person);
      if (done?.sentAt) continue; // they've had this line already
      const r = i.random ? i.random() : stableUnit(exp.id, i.person);
      const v = done ? keepOrPick(done.variantId, exp.variants, exp.allocation, r).variant : pickVariant(exp.variants, exp.allocation, r);
      if (!v) continue;
      if (isOpener) opener = true;
      out.push({
        experimentId: exp.id,
        variantId: v.id,
        slot: exp.slot,
        key: isOpener ? "opener" : parsed.ref,
        text: fillName(v.text, i.name),
        forced: isOpener || parsed.ref === "follow_up_1",
      });
    }
    return out;
  } catch (err) {
    warn("lines for draft", err);
    return [];
  }
}

/** The prompt section: the one line to use for each slot. Kevin's method
 *  still rules: a line is used only when its moment comes, and holding is fine. */
export function linesBlock(lines: OfferedLine[]): string {
  if (!lines.length) return "";
  const rows = lines.map((l) => {
    if (l.key === "opener") return `- opener: this draft is your first reply to them. Say it like this: "${l.text}"`;
    const brief = LINE_KEYS.find((k) => k.key === (l.key as LineKey))?.brief ?? l.key;
    return l.forced ? `- ${l.key}: ${brief}. Say it like this: "${l.text}"` : `- ${l.key}: only if ${brief} in this draft, say it like this: "${l.text}"`;
  });
  return (
    "TEST LINES (Kevin is testing these). When a line's moment comes, say it like this: your words, same idea and length, " +
    "matching the thread's casing. Never force a line in when its moment hasn't come, and holding is still fine.\n" +
    rows.join("\n") +
    '\nList the ones you used in "ab_lines_used", e.g. ["opener"]. Empty list when none.'
  );
}

/** What the draft records (Draft.abVariants): every offered line, used or not. */
export function tagsFor(lines: OfferedLine[], reported: unknown, bubbles: string[]): AbTag[] {
  const said = new Set(Array.isArray(reported) ? reported.map((x) => String(x).trim().toLowerCase()) : []);
  return lines.map((l) => ({
    experimentId: l.experimentId,
    variantId: l.variantId,
    slot: l.slot,
    used: said.has(l.key) || (l.forced && bubbles.length > 0) || lineUsed(l.text, bubbles),
  }));
}

/** The draft went out (approved or auto-sent): attribute each used line to
 *  its variant. This is when a J line is assigned for good. A heavy edit is
 *  recorded as edited, and still attributed. Never called for a rejected or
 *  unsent draft, so those never count. */
export async function recordSent(input: {
  person: Person;
  draftId: string;
  abVariants: unknown;
  bubbles: string[];
  edited: boolean;
  at: Date;
  store?: ExperimentStore;
}): Promise<void> {
  try {
    const tags = readAbTags(input.abVariants);
    if (!tags.length) return;
    const store = input.store ?? experimentStore();
    for (const t of tags) {
      const exp = await store.get(input.person.workspaceId, t.experimentId);
      const v = exp?.variants.find((x) => x.id === t.variantId);
      if (!exp || !v) continue;
      // Offered but unused, unless Kevin wrote the line in himself while editing.
      if (!t.used && !lineUsed(fillName(v.text, null), input.bubbles) && !lineUsed(v.text, input.bubbles)) continue;
      // First time out: they get this variant for good (a racing row wins).
      const row = (await store.findAssignment(t.experimentId, input.person)) ?? (await store.createAssignment(t.experimentId, v.id, input.person));
      if (row.sentAt) continue;
      await store.markSent(t.experimentId, input.person, {
        draftId: input.draftId,
        at: input.at,
        edited: input.edited && editedHeavily(v.text, input.bubbles),
        text: input.bubbles.join("\n\n"),
      });
    }
  } catch (err) {
    warn("record sent", err);
  }
}
