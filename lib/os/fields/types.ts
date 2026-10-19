// Global custom fields (Settings › Custom fields). Contract from wave 0; owner: S3.
// Pure: client components import the labels and the validation.
import type { CustomFieldType } from "@/app/generated/prisma/enums";

export type { CustomFieldType };

export interface CustomFieldView {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  builtIn: boolean;
  options: string[];
  ghlField: string | null;
  kitField: string | null;
  sortOrder: number;
  /** Setter ids that fill it. */
  usedBy: string[];
}

export type FieldValueSource = "j" | "user" | "import";

/** Built-in fields every workspace has (seeded by the 20261020020000 migration). */
export const BUILT_IN_FIELDS = [
  { key: "first_name", label: "First name", type: "TEXT" },
  { key: "email", label: "Email", type: "EMAIL" },
] as const;

export const FIELD_TYPES: { type: CustomFieldType; label: string }[] = [
  { type: "TEXT", label: "Text" },
  { type: "LONG_TEXT", label: "Long text" },
  { type: "NUMBER", label: "Number" },
  { type: "EMAIL", label: "Email" },
  { type: "DATE", label: "Date" },
  { type: "TIMEZONE", label: "Timezone" },
  { type: "SELECT", label: "Select" },
  { type: "URL", label: "URL" },
];

export function fieldTypeLabel(type: CustomFieldType): string {
  return FIELD_TYPES.find((t) => t.type === type)?.label ?? type;
}

export function isBuiltInKey(key: string): boolean {
  return BUILT_IN_FIELDS.some((f) => f.key === key);
}

/** "Monthly revenue" → "monthly_revenue". Stable once saved. */
export function fieldKeyFrom(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export interface FieldInput {
  label: string;
  type: CustomFieldType;
  options?: string[];
  ghlField?: string | null;
  kitField?: string | null;
}

export interface CleanField {
  label: string;
  type: CustomFieldType;
  options: string[];
  ghlField: string | null;
  kitField: string | null;
}

const ref = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);

/** Validate a field from the form. */
export function cleanFieldInput(input: Partial<FieldInput> | null | undefined): CleanField | { error: string } {
  const label = typeof input?.label === "string" ? input.label.trim().replace(/\s+/g, " ") : "";
  if (!label) return { error: "Name the field." };
  if (label.length > 60) return { error: "Keep the name under 60 characters." };
  if (!fieldKeyFrom(label)) return { error: "Use letters or numbers in the name." };
  const type = FIELD_TYPES.find((t) => t.type === input?.type)?.type;
  if (!type) return { error: "Pick a type." };
  const options =
    type === "SELECT"
      ? [...new Set((Array.isArray(input?.options) ? input.options : []).map((o) => String(o).trim()).filter(Boolean))].slice(0, 30)
      : [];
  if (type === "SELECT" && !options.length) return { error: "Add at least one choice." };
  return { label, type, options, ghlField: ref(input?.ghlField), kitField: ref(input?.kitField) };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A value as stored, or an error for one that doesn't fit the type. Blank = clear. */
export function cleanFieldValue(type: CustomFieldType, raw: unknown, options: string[] = []): { value: string | null } | { error: string } {
  if (raw == null) return { value: null };
  const v = (typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw)).trim().slice(0, type === "LONG_TEXT" ? 2000 : 500);
  if (!v) return { value: null };
  switch (type) {
    case "EMAIL":
      return EMAIL.test(v) ? { value: v.toLowerCase() } : { error: "That doesn't look like an email address." };
    case "NUMBER": {
      const n = Number(v.replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? { value: String(n) } : { error: "That isn't a number." };
    }
    case "URL":
      try {
        const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
        return { value: u.toString() };
      } catch {
        return { error: "That isn't a link." };
      }
    case "SELECT": {
      const hit = options.find((o) => o.toLowerCase() === v.toLowerCase());
      return hit ? { value: hit } : options.length ? { error: `Pick one of: ${options.join(", ")}.` } : { value: v };
    }
    default:
      return { value: v };
  }
}

/** One row of the Details tab's Fields block. */
export interface DetailsField {
  fieldId: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  value: string | null;
  source: FieldValueSource | "instagram" | null;
  /** When it was filled (ISO). */
  at: string | null;
  /** The contact's setter fills it. */
  bySetter: boolean;
}
