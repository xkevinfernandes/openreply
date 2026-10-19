// A/B testing at send time. Two callers:
//  - OpenReply's DM worker (one hook): campaignOpenerText picks the opening DM.
//  - J (lib/os/setter/service.ts): linesForDraft puts the assigned lines in
//    the prompt, tagsFor records which ones the draft carries, and recordSent
//    attributes them once Kevin approves.
// Nothing here may break a send: every entry point swallows its errors and
// falls back to the original text / no lines.

import { fillName, keepOrPick } from "@/lib/os/experiments/assign";
import { editedHeavily, lineUsed } from "@/lib/os/experiments/similarity";
import { experimentStore, type ExperimentStore, type Person } from "@/lib/os/experiments/store";
import { recordSend } from "@/lib/os/sending/cap";
import { LINE_KEYS, parseSlot, readAbTags, slotOf, type AbTag, type ExperimentLite, type LineKey, type VariantLite } from "@/lib/os/experiments/types";

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
  /** "opener" or a line key; what J reports back in ab_lines_used. */
  key: string;
  text: string;
  /** This draft IS that line (the opener, follow-up 1): no "if" about it. */
  forced: boolean;
}

export interface LinesInput {
  workspaceId: string;
  setterId: string | null;
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
  random?: () => number;
}

/** The slots that apply to this draft, most specific first per kind. */
export function candidateSlots(i: Pick<LinesInput, "entry" | "actionKind" | "firstMessage" | "nudgesSoFar" | "alreadyInvited">): string[] {
  const slots: string[] = [];
  if (i.firstMessage || i.actionKind === "value_opener") {
    if (i.entry) slots.push(slotOf("j_opener", i.entry));
    slots.push(slotOf("j_opener", "any"));
  } else {
    slots.push(slotOf("line", "permission_ask"), slotOf("line", "value_offer"));
    if (!i.alreadyInvited) slots.push(slotOf("line", "invite"));
  }
  if (i.actionKind === "nudge" && i.nudgesSoFar === 0) slots.push(slotOf("line", "follow_up_1"));
  return slots;
}

export async function linesForDraft(i: LinesInput): Promise<OfferedLine[]> {
  try {
    const store = i.store ?? experimentStore();
    const slots = candidateSlots(i);
    const running = (await store.running(i.workspaceId, slots)).filter((e) => !e.setterId || e.setterId === i.setterId);
    const out: OfferedLine[] = [];
    let opener = false;
    for (const slot of slots) {
      const exp = running.find((e) => e.slot === slot);
      if (!exp) continue;
      const parsed = parseSlot(slot);
      if (!parsed) continue;
      const isOpener = parsed.kind === "j_opener";
      if (isOpener && opener) continue; // the specific entry beat "any"
      const done = await store.findAssignment(exp.id, i.person);
      if (done?.sentAt) continue; // they've had this line already
      const v = await assignFor(store, exp, i.person, i.random ?? Math.random);
      if (!v) continue;
      if (isOpener) opener = true;
      out.push({
        experimentId: exp.id,
        variantId: v.id,
        slot,
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

/** The prompt section: the line to use for each slot. Kevin's method still
 *  rules: a line is used only when its moment comes, and holding is fine. */
export function linesBlock(lines: OfferedLine[]): string {
  if (!lines.length) return "";
  const rows = lines.map((l) => {
    if (l.key === "opener") return `- opener: this draft is your first message to them. Use this as your first bubble: "${l.text}"`;
    const brief = LINE_KEYS.find((k) => k.key === (l.key as LineKey))?.brief ?? l.key;
    return l.forced
      ? `- ${l.key}: ${brief}. Use this line for it: "${l.text}"`
      : `- ${l.key}: only if ${brief} in this draft, use this line for it: "${l.text}"`;
  });
  return (
    "A/B LINES (Kevin is testing these words). When the moment for a line comes, use it as written; you may only " +
    "match the thread's casing and punctuation. Never force a line in when its moment hasn't come, and holding is still fine.\n" +
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

/** Approve sent the draft: attribute each used line to its variant. A heavy
 *  edit is recorded as edited, and still attributed. */
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
