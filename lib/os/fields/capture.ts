// J's draft output -> ContactFieldValue (source "j"). Called after a draft is
// sent (lib/os/events-hooks.ts onDraftSent). The hook passes raw undefined,
// so Draft.raw is loaded by draftId. Never overwrites a value Kevin typed
// (source "user"), then pushes the contact to the CRMs.
import { prisma } from "@/lib/db/client";
import { cleanFieldValue, type CustomFieldType } from "@/lib/os/fields/types";
import { fireContactEvent } from "@/lib/os/integrations/events";
import type { SyncEvent } from "@/lib/os/integrations/mapping";

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
  write(row: { contactId: string; fieldId: string; value: string; draftId: string }): Promise<void>;
  fire(event: { workspaceId: string; contactId: string; event: SyncEvent }): Promise<void>;
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

/** Pure: which values to write. Skips user values, unchanged values and fields the setter doesn't fill. */
export function planCapture(
  answers: Map<string, string>,
  fields: CaptureField[],
  setterFieldIds: string[],
  existing: { fieldId: string; value: string; source: string }[]
): { fieldId: string; value: string }[] {
  const allowed = setterFieldIds.length ? new Set(setterFieldIds) : null;
  const byField = new Map(existing.map((e) => [e.fieldId, e]));
  const out: { fieldId: string; value: string }[] = [];
  for (const f of fields) {
    const raw = answers.get(f.key);
    if (raw == null || (allowed && !allowed.has(f.id))) continue;
    const clean = cleanFieldValue(f.type, raw, f.options);
    if ("error" in clean || clean.value == null) continue;
    const prev = byField.get(f.id);
    if (prev?.source === "user" || prev?.value === clean.value) continue;
    out.push({ fieldId: f.id, value: clean.value });
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
  async write({ contactId, fieldId, value, draftId }) {
    // updateMany guards the race with an edit Kevin made since the read.
    const updated = await prisma.contactFieldValue.updateMany({ where: { contactId, fieldId, source: { not: "user" } }, data: { value, source: "j", draftId } });
    if (updated.count) return;
    await prisma.contactFieldValue.createMany({ data: [{ contactId, fieldId, value, source: "j", draftId }], skipDuplicates: true });
  },
  fire: fireContactEvent,
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
  for (const row of plan) await deps.write({ contactId: input.contactId, fieldId: row.fieldId, value: row.value, draftId: input.draftId });
  if (plan.length) await deps.fire({ workspaceId: input.workspaceId, contactId: input.contactId, event: "manual" });
  return plan.length;
}
