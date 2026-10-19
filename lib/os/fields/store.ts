// Custom field reads. Wave-0 stub with the real reads S3 builds on; owner: S3.
import { prisma } from "@/lib/db/client";
import type { ContactFieldValueView, CustomFieldView, FieldValueSource } from "@/lib/os/fields/types";

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

export async function contactFieldValues(contactId: string): Promise<ContactFieldValueView[]> {
  const rows = await prisma.contactFieldValue.findMany({ where: { contactId }, include: { field: true } });
  return rows
    .sort((a, b) => a.field.sortOrder - b.field.sortOrder)
    .map((r) => ({ fieldId: r.fieldId, key: r.field.key, label: r.field.label, value: r.value, source: r.source as FieldValueSource, updatedAt: r.updatedAt.toISOString() }));
}
