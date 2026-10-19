// Global custom fields (Settings › Custom fields). Contract from wave 0; owner: S3.
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

export interface ContactFieldValueView {
  fieldId: string;
  key: string;
  label: string;
  value: string;
  source: FieldValueSource;
  updatedAt: string;
}

/** Built-in fields every workspace has (seeded by the 20261020020000 migration). */
export const BUILT_IN_FIELDS = [
  { key: "first_name", label: "First name", type: "TEXT" },
  { key: "email", label: "Email", type: "EMAIL" },
] as const;
