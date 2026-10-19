// J's draft output -> contact fields through writeField (source "j", ref =
// the draft). Called after a draft is sent (lib/os/events-hooks.ts
// onDraftSent). The hook passes raw undefined, so Draft.raw is loaded by
// draftId. writeField keeps Kevin's values, the history and the batched push.
import { prisma } from "@/lib/db/client";
import { coerceFieldValue, isLocked } from "@/lib/os/fields/merge";
import type { CustomFieldType } from "@/lib/os/fields/types";
import { writeField } from "@/lib/os/fields/write";

export interface CaptureInput {
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  draftId: string;
  /** Draft.raw (J's output JSON). Loaded by draftId when missing. */
  raw?: unknown;
}

export interface CaptureField {
  id: string;
  key: string;
  type: CustomFieldType;
  options: string[];
}

export interface CaptureDeps {
  draftRaw(draftId: string, workspaceId: string): Promise<unknown>;
  fields(workspaceId: string): Promise<CaptureField[]>;
  /** Field ids the setter fills; empty = the setter has no list (take every field). */
  setterFieldIds(setterId: string): Promise<string[]>;
  existing(contactId: string): Promise<{ fieldId: string; value: string; source: string }[]>;
  /** writeField for one answer; true when it was stored. */
  write(row: { workspaceId: string; contactId: string; key: string; value: string; draftId: string }): Promise<boolean>;
}

const scalar = (v: unknown): string | null => {
  if (v == null || typeof v === "object") return null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v).trim();
  return s && s.toLowerCase() !== "null" && s.toLowerCase() !== "unknown" ? s : null;
};

/**
 * Field answers in J's output, by key. `fields` (object or [{key, value}])
 * wins over the older `qualification` / `invite` blocks.
 */
export function answersFromRaw(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { fields?: unknown; qualification?: unknown; invite?: unknown };
  const put = (key: unknown, value: unknown) => {
    const k = typeof key === "string" ? key.trim() : "";
    const v = scalar(value);
    if (k && v && !out.has(k)) out.set(k, v);
  };
  if (Array.isArray(r.fields)) for (const f of r.fields) put((f as { key?: unknown })?.key, (f as { value?: unknown })?.value);
  else if (r.fields && typeof r.fields === "object") for (const [k, v] of Object.entries(r.fields)) put(k, v);
  for (const block of [r.qualification, r.invite]) {
    if (!block || typeof block !== "object") continue;
    for (const [k, v] of Object.entries(block)) {
      if (k === "fit_score" && (v === 0 || v === "0")) continue;
      put(k, v);
    }
  }
  return out;
}

/**
 * Pure: which answers to write. Skips Kevin's values, unchanged values and
 * fields the setter doesn't fill. A value that doesn't fit the type is still
 * written as said (writeField stores it, unpushed); `raw` is what J said.
 */
export function planCapture(
  answers: Map<string, string>,
  fields: CaptureField[],
  setterFieldIds: string[],
  existing: { fieldId: string; value: string; source: string }[]
): { fieldId: string; key: string; value: string; raw: string }[] {
  const allowed = setterFieldIds.length ? new Set(setterFieldIds) : null;
  const byField = new Map(existing.map((e) => [e.fieldId, e]));
  const out: { fieldId: string; key: string; value: string; raw: string }[] = [];
  for (const f of fields) {
    const raw = answers.get(f.key);
    if (raw == null || (allowed && !allowed.has(f.id))) continue;
    const clean = coerceFieldValue(f, raw);
    if ("error" in clean || clean.value == null) continue;
    // An unparseable email would never be the email: leave the field alone.
    if (f.type === "EMAIL" && !clean.pushable) continue;
    const prev = byField.get(f.id);
    if (isLocked(prev?.source) || prev?.value === clean.value) continue;
    out.push({ fieldId: f.id, key: f.key, value: clean.value, raw });
  }
  return out;
}

const dbDeps: CaptureDeps = {
  async draftRaw(draftId, workspaceId) {
    return (await prisma.draft.findFirst({ where: { id: draftId, workspaceId }, select: { raw: true } }))?.raw ?? null;
  },
  async fields(workspaceId) {
    const rows = await prisma.customField.findMany({ where: { workspaceId }, select: { id: true, key: true, type: true, options: true } });
    return rows.map((r) => ({ ...r, options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [] }));
  },
  async setterFieldIds(setterId) {
    return (await prisma.setterField.findMany({ where: { setterId }, select: { fieldId: true } })).map((r) => r.fieldId);
  },
  existing(contactId) {
    return prisma.contactFieldValue.findMany({ where: { contactId }, select: { fieldId: true, value: true, source: true } });
  },
  async write({ workspaceId, contactId, key, value, draftId }) {
    const r = await writeField({ workspaceId, contactId, key, value, source: "j", ref: draftId });
    return "applied" in r && r.applied;
  },
};

/** Returns how many values were written. */
export async function captureFields(input: CaptureInput, deps: CaptureDeps = dbDeps): Promise<number> {
  const raw = input.raw ?? (await deps.draftRaw(input.draftId, input.workspaceId));
  const answers = answersFromRaw(raw);
  if (!answers.size) return 0;
  const [fields, setterIds, existing] = await Promise.all([
    deps.fields(input.workspaceId),
    input.setterId ? deps.setterFieldIds(input.setterId) : Promise.resolve([]),
    deps.existing(input.contactId),
  ]);
  const plan = planCapture(answers, fields, setterIds, existing);
  let written = 0;
  // writeField marks the contact dirty: one push 30s after the last answer.
  for (const row of plan) if (await deps.write({ workspaceId: input.workspaceId, contactId: input.contactId, key: row.key, value: row.raw, draftId: input.draftId })) written++;
  return written;
}
