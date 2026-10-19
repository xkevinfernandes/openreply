// Custom fields: the global list (Settings › Custom fields) and the values on
// each contact. Owner: S3. Fields always come from the DB (also under OS_MOCK);
// sample contacts keep their values in lib/os/mock-contacts.ts.
import { prisma } from "@/lib/db/client";
import { coerceFieldValue } from "@/lib/os/fields/merge";
import {
  cleanFieldInput,
  fieldKeyFrom,
  type CustomFieldView,
  type FieldInput,
} from "@/lib/os/fields/types";
import { writeField } from "@/lib/os/fields/write";
import { osMockEnabled } from "@/lib/os/mock";
import { setMockFieldValue } from "@/lib/os/mock-contacts";

export async function listCustomFields(workspaceId: string): Promise<CustomFieldView[]> {
  const rows = await prisma.customField.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    include: { setters: { select: { setterId: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type,
    builtIn: r.builtIn,
    options: Array.isArray(r.options) ? (r.options as unknown[]).map(String) : [],
    ghlField: r.ghlField,
    kitField: r.kitField,
    sortOrder: r.sortOrder,
    usedBy: r.setters.map((s) => s.setterId),
  }));
}

/** A key not taken yet: business, business_2, … */
export function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export type FieldResult = { field: CustomFieldView } | { error: string };

export async function createCustomField(workspaceId: string, input: Partial<FieldInput>): Promise<FieldResult> {
  const clean = cleanFieldInput(input);
  if ("error" in clean) return clean;
  const existing = await prisma.customField.findMany({ where: { workspaceId }, select: { key: true, sortOrder: true, label: true } });
  if (existing.some((f) => f.label.toLowerCase() === clean.label.toLowerCase())) return { error: "There's already a field with that name." };
  const key = uniqueKey(fieldKeyFrom(clean.label), new Set(existing.map((f) => f.key)));
  const sortOrder = existing.reduce((m, f) => Math.max(m, f.sortOrder), -1) + 1;
  await prisma.customField.create({ data: { workspaceId, key, ...clean, sortOrder } });
  const field = (await listCustomFields(workspaceId)).find((f) => f.key === key);
  return field ? { field } : { error: "That didn't save." };
}

/** Built-ins keep their name and type; only the CRM mapping changes. */
export async function updateCustomField(workspaceId: string, id: string, input: Partial<FieldInput>): Promise<FieldResult> {
  const row = await prisma.customField.findFirst({ where: { id, workspaceId } });
  if (!row) return { error: "That field is gone. Refresh." };
  const clean = cleanFieldInput({
    label: row.builtIn ? row.label : (input.label ?? row.label),
    type: row.builtIn ? row.type : (input.type ?? row.type),
    options: input.options ?? (Array.isArray(row.options) ? (row.options as unknown[]).map(String) : []),
    ghlField: input.ghlField !== undefined ? input.ghlField : row.ghlField,
    kitField: input.kitField !== undefined ? input.kitField : row.kitField,
  });
  if ("error" in clean) return clean;
  const clash = await prisma.customField.findFirst({ where: { workspaceId, id: { not: id }, label: { equals: clean.label, mode: "insensitive" } }, select: { id: true } });
  if (clash) return { error: "There's already a field with that name." };
  await prisma.customField.update({ where: { id }, data: clean });
  const field = (await listCustomFields(workspaceId)).find((f) => f.id === id);
  return field ? { field } : { error: "That didn't save." };
}

export async function deleteCustomField(workspaceId: string, id: string): Promise<{ ok: true } | { error: string }> {
  const row = await prisma.customField.findFirst({ where: { id, workspaceId }, select: { builtIn: true } });
  if (!row) return { ok: true };
  if (row.builtIn) return { error: "Built-in fields can't be deleted." };
  await prisma.customField.delete({ where: { id } });
  return { ok: true };
}

/**
 * Kevin edits a value in the Details tab: written as Kevin's (locked: J and
 * steps never overwrite it), with history and the batched CRM push. An email
 * also lands on the Contact row so the email gate and Kit keep working.
 * Clearing a value clears it here only; the CRMs keep theirs.
 */
export async function setContactFieldValue(
  workspaceId: string,
  contactId: string,
  fieldKey: string,
  raw: string | null
): Promise<{ value: string | null } | { error: string }> {
  if (osMockEnabled()) {
    const field = await prisma.customField.findUnique({ where: { workspaceId_key: { workspaceId, key: fieldKey } } });
    if (!field) return { error: "That field is gone. Refresh." };
    const clean = coerceFieldValue({ type: field.type, options: Array.isArray(field.options) ? (field.options as unknown[]).map(String) : [] }, raw, { strict: true });
    if ("error" in clean) return clean;
    setMockFieldValue(contactId, field.key, clean.value, "user");
    return { value: clean.value };
  }
  const r = await writeField({ workspaceId, contactId, key: fieldKey, value: raw, source: "kevin" });
  return "error" in r ? r : { value: r.value };
}
