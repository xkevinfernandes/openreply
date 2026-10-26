// What we push to a CRM and where each value lands (spec items 20-21).
// Pure: no DB, no fetch, no Node APIs (the mapping screen imports it). The engine builds a ContactSnapshot, this turns it
// into a provider-neutral SyncPayload, and kit.ts / ghl.ts send it.
import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { stageLabels } from "@/lib/os/labels";

export type SyncProviderId = "kit" | "ghl";

export type SyncEvent = "email_captured" | "stage_changed" | "tags_changed" | "kind_changed" | "backfill" | "manual";

/** The setter's qualification read (Draft.raw.qualification + raw.invite).
 *  Each key is also a global custom field (Settings › Custom fields), and the
 *  field's ghlField / kitField says where it goes. */
export const QUALIFICATION_FIELDS = [
  { key: "their_goal", label: "Their goal" },
  { key: "their_challenge", label: "Their challenge" },
  { key: "in_the_way", label: "What's in the way" },
  { key: "tried_before", label: "What they've tried" },
  { key: "niche", label: "Niche" },
  { key: "monthly_revenue", label: "Monthly revenue" },
  { key: "pain", label: "Pain" },
  { key: "is_owner", label: "Runs the business" },
  { key: "fit_score", label: "Fit score (0-5)" },
] as const;

export type QualificationKey = (typeof QUALIFICATION_FIELDS)[number]["key"];
export type QualificationAnswers = Partial<Record<QualificationKey, string>>;

/**
 * Where each value goes. Custom-field targets hold the provider's own field
 * reference: a Kit custom field key, or a GoHighLevel custom field id (or a
 * "contact.my_field" key). null = don't send.
 */
export interface FieldMapping {
  /** "sales" (default) keeps personal DMs out of the CRM. */
  scope: "sales" | "all";
  firstName: boolean;
  email: boolean;
  tags: boolean;
  /** Prepended to every tag we push, e.g. "ig-". */
  tagPrefix: string;
  igHandle: string | null;
  stage: string | null;
  kind: string | null;
  /** Legacy, read-only: where each qualification key went before custom
   *  fields carried their own target. Only used for a key no custom field
   *  has a target for; never written by the mapping screen any more. */
  qualification: Partial<Record<QualificationKey, string | null>>;
  /** GoHighLevel only: also move an opportunity through this pipeline. */
  pipelineId?: string | null;
  stageMap?: Partial<Record<ContactStage, string | null>>;
}

export function defaultMapping(): FieldMapping {
  return { scope: "sales", firstName: true, email: true, tags: true, tagPrefix: "", igHandle: null, stage: null, kind: null, qualification: {} };
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);

/** Read a stored mapping (Json column) defensively. */
export function normalizeMapping(raw: unknown): FieldMapping {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const base = defaultMapping();
  const qual: FieldMapping["qualification"] = {};
  const rawQual = (m.qualification && typeof m.qualification === "object" ? m.qualification : {}) as Record<string, unknown>;
  for (const f of QUALIFICATION_FIELDS) {
    const v = str(rawQual[f.key]);
    if (v) qual[f.key] = v;
  }
  const stageMap: NonNullable<FieldMapping["stageMap"]> = {};
  const rawStages = (m.stageMap && typeof m.stageMap === "object" ? m.stageMap : {}) as Record<string, unknown>;
  for (const s of Object.keys(stageLabels) as ContactStage[]) {
    const v = str(rawStages[s]);
    if (v) stageMap[s] = v;
  }
  return {
    scope: m.scope === "all" ? "all" : "sales",
    firstName: typeof m.firstName === "boolean" ? m.firstName : base.firstName,
    email: typeof m.email === "boolean" ? m.email : base.email,
    tags: typeof m.tags === "boolean" ? m.tags : base.tags,
    tagPrefix: (str(m.tagPrefix) ?? "").slice(0, 30),
    igHandle: str(m.igHandle),
    stage: str(m.stage),
    kind: str(m.kind),
    qualification: qual,
    pipelineId: str(m.pipelineId),
    stageMap,
  };
}

/** The mapping to save from the form: everything from the form except the
 *  legacy qualification targets, which stay as stored (read-only fallback). */
export function withStoredQualification(fromForm: unknown, stored: unknown): FieldMapping {
  return { ...normalizeMapping(fromForm), qualification: normalizeMapping(stored).qualification };
}

/** The contact as the sync engine sees it. */
export interface ContactSnapshot {
  id: string;
  kind: ContactKind;
  stage: ContactStage;
  username: string | null;
  fullName: string | null;
  email: string | null;
  tags: string[];
  qualification: QualificationAnswers;
  /** Global custom fields with a value (CustomField + ContactFieldValue).
   *  Each field carries its own GoHighLevel / Kit target. */
  fields?: SnapshotField[];
  /** Every global custom field's targets, with or without a value, so a
   *  qualification answer from a draft lands on its field's target. */
  targets?: FieldTarget[];
}

export interface FieldTarget {
  key: string;
  ghlField: string | null;
  kitField: string | null;
}

export interface SnapshotField {
  key: string;
  value: string;
  ghlField: string | null;
  kitField: string | null;
  /** False when the value doesn't fit the field's type ("about 5k" in a
   *  number field that didn't parse): kept in DM OS, never pushed. */
  pushable?: boolean;
}

/** Provider-neutral push. custom maps the provider's field reference to a value. */
export interface SyncPayload {
  email: string | null;
  /** From a "phone" field. GoHighLevel can create a contact on it. */
  phone: string | null;
  /** Instagram handle without the @. */
  handle: string | null;
  firstName: string | null;
  tags: string[];
  /** Tags removed on purpose (removeTag) to remove there too. Tags are add-only otherwise. */
  removeTags?: string[];
  custom: Record<string, string>;
  stage: ContactStage;
  /** Set when the mapping has a pipeline (GoHighLevel). */
  pipeline: { pipelineId: string; stageId: string | null } | null;
  name: string;
}

export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first.slice(0, 80) : null;
}

const KIND_LABELS: Record<ContactKind, string> = { SALES: "Sales", PERSONAL: "Personal", UNSORTED: "Unsorted", PITCHES: "Pitches" };

/** first_name / email have their own slots in the payload (firstName, email),
 *  so a custom field target on them is never used. */
export const NATIVE_FIELD_KEYS = ["first_name", "email"] as const;

export function isNativeFieldKey(key: string): boolean {
  return (NATIVE_FIELD_KEYS as readonly string[]).includes(key);
}

/** A field's target for one provider. */
export function targetFor(f: { ghlField: string | null; kitField: string | null }, provider: SyncProviderId): string | null {
  return (provider === "ghl" ? f.ghlField : f.kitField) || null;
}

/**
 * The push for one provider. Custom fields come from the global field list
 * (each field's ghlField / kitField). The old per-provider qualification
 * mapping is a fallback only for a key whose custom field has no target.
 */
export function buildPayload(c: ContactSnapshot, m: FieldMapping, provider?: SyncProviderId): SyncPayload {
  const custom: Record<string, string> = {};
  const put = (target: string | null | undefined, value: string | null | undefined) => {
    if (target && value != null && String(value).trim() && custom[target] == null) custom[target] = String(value).trim().slice(0, 500);
  };
  put(m.igHandle, c.username ? `@${c.username}` : null);
  put(m.stage, stageLabels[c.stage]);
  put(m.kind, KIND_LABELS[c.kind]);
  const covered = new Set<string>();
  if (provider) {
    for (const f of c.fields ?? []) {
      const target = targetFor(f, provider);
      if (!target || isNativeFieldKey(f.key) || f.pushable === false) continue;
      put(target, f.value);
      covered.add(f.key);
    }
  }
  for (const f of QUALIFICATION_FIELDS) {
    if (covered.has(f.key)) continue;
    const field = c.fields?.find((x) => x.key === f.key);
    const own = provider ? c.targets?.find((t) => t.key === f.key) : undefined;
    put((own && provider ? targetFor(own, provider) : null) ?? m.qualification[f.key], field ? (field.pushable === false ? null : field.value) : c.qualification[f.key]);
  }

  const tags = m.tags ? [...new Set(c.tags.map((t) => t.trim()).filter(Boolean).map((t) => `${m.tagPrefix}${t}`))].sort() : [];
  const own = (key: string) => {
    const f = c.fields?.find((x) => x.key === key);
    return f && f.pushable !== false ? f.value?.trim() || null : null;
  };
  return {
    email: m.email ? (c.email?.trim().toLowerCase() || own("email")?.toLowerCase() || null) : null,
    phone: own("phone"),
    handle: c.username?.trim() || null,
    firstName: m.firstName ? (own("first_name")?.slice(0, 80) ?? firstNameOf(c.fullName)) : null,
    tags,
    custom,
    stage: c.stage,
    pipeline: m.pipelineId ? { pipelineId: m.pipelineId, stageId: m.stageMap?.[c.stage] ?? null } : null,
    name: c.fullName?.trim() || (c.username ? `@${c.username}` : "Instagram contact"),
  };
}

/** Should this contact be in the CRM at all? */
export function inScope(c: Pick<ContactSnapshot, "kind">, m: FieldMapping): boolean {
  return m.scope === "all" || c.kind === "SALES";
}

/** Latest non-empty answer per qualification key, from the setter's draft JSON (newest first). */
export function qualificationFromDrafts(raws: unknown[]): QualificationAnswers {
  const out: QualificationAnswers = {};
  for (const raw of raws) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { qualification?: Record<string, unknown> | null; invite?: Record<string, unknown> | null };
    const sources = [r.qualification ?? {}, r.invite ?? {}];
    for (const f of QUALIFICATION_FIELDS) {
      if (out[f.key] != null) continue;
      for (const src of sources) {
        const v = (src as Record<string, unknown>)[f.key];
        if (v == null || v === "" || (f.key === "fit_score" && v === 0)) continue;
        out[f.key] = typeof v === "boolean" ? (v ? "yes" : "no") : String(v).trim().slice(0, 500);
        break;
      }
    }
  }
  return out;
}

/** One row of the mapping screen's Custom fields section. */
export interface MappingFieldRow {
  id: string;
  key: string;
  label: string;
  /** "first_name" / "email": sent in the provider's own slot, not remappable. */
  native: boolean;
  /** The field's own target for this provider (Settings › Custom fields). */
  target: string | null;
}

/** Every global custom field, in the fields' order, with its target for the provider. */
export function mappingFieldRows(
  fields: { id: string; key: string; label: string; ghlField: string | null; kitField: string | null; sortOrder?: number }[],
  provider: SyncProviderId
): MappingFieldRow[] {
  return [...fields]
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (a.f.sortOrder ?? a.i) - (b.f.sortOrder ?? b.i) || a.i - b.i)
    .map(({ f }) => ({ id: f.id, key: f.key, label: f.label, native: isNativeFieldKey(f.key), target: isNativeFieldKey(f.key) ? null : targetFor(f, provider) }));
}
