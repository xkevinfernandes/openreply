// Knowledge bases, the pure half: the shapes a Setter / Resource row holds,
// how they turn into what J reads (SetterProfile + catalog rows), and back.
// The database half is lib/os/setter/setters.ts; the file fallback is
// lib/os/setter/knowledge.ts. Nothing here does I/O, so tests use it directly.

import { z } from "zod";
import { profilePartsFromDocs, type SetterDocs } from "@/lib/os/setter/knowledge/docs";
import type { ClientSettings, Episode, FieldToFill, FunnelStage, Offer, SetterProfile, VoiceCorrection } from "@/lib/os/setter/profile";
import type { SetterContact } from "@/lib/os/setter/store";
import type { Catalog, CatalogRow, CatalogTrigger } from "@/lib/os/setter/types";

// ---------------------------------------------------------------- shapes
const str = z.string().catch("");
const optStr = z.string().optional().catch(undefined);

export const OfferSchema = z.object({
  name: str,
  status: z.enum(["open", "closed", "draft"]).catch("draft"),
  sold_by: z.enum(["call", "doc", "either"]).catch("call"),
  price: optStr,
  price_in_dms: z.enum(["yes", "no"]).catch("no"),
  length: optStr,
  open_from: optStr,
  open_until: optStr,
  doc_url: optStr,
  payment_url: optStr,
  pitch: optStr,
  fit_criteria: optStr,
  notes: str,
});

export const FunnelStageSchema = z.object({
  key: str,
  label: str,
  guidance: str,
  variations: z.array(z.unknown()).optional().catch(undefined),
  ab: z.boolean().optional().catch(undefined),
  autopilot: z.enum(["approve", "auto"]).optional().catch(undefined),
});

/** At most this many variations per stage (the prompt stays short). */
export const MAX_VARIATIONS = 8;
export const CorrectionSchema = z.object({ title: str, body: str });
export const ObjectionSchema = z.object({ objection: str, response: str });
export const BusinessSchema = z.object({
  sections: z.record(z.string(), z.string()).catch({}),
  objections: z.array(ObjectionSchema).catch([]),
});
export const SettingsSchema = z.looseObject({
  ig_username: optStr,
  operator: optStr,
  audience: z.enum(["b2b", "b2c"]).optional().catch(undefined),
  allowed_emojis: z.array(z.string()).optional().catch(undefined),
  cal_com_url: optStr,
  tag_options: z.array(z.string()).optional().catch(undefined),
});

/** Blank optional strings are dropped so the renderer's `if (o.price)` stays meaningful. */
function compact<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;
}

export function asOffers(v: unknown): Offer[] {
  const list = z.array(z.unknown()).catch([]).parse(v);
  return list
    .map((x) => OfferSchema.parse(x && typeof x === "object" ? x : {}))
    .filter((o) => o.name.trim())
    .map((o) => ({ ...compact(o), name: o.name.trim(), notes: o.notes ?? "", status: o.status, sold_by: o.sold_by }) as Offer);
}

export function asFunnel(v: unknown): FunnelStage[] {
  return z
    .array(z.unknown())
    .catch([])
    .parse(v)
    .map((x) => FunnelStageSchema.parse(x && typeof x === "object" ? x : {}))
    .filter((s) => s.label.trim() && s.guidance.trim())
    .map((s) => {
      const out: FunnelStage = { key: s.key || slugify(s.label), label: s.label.trim(), guidance: s.guidance.trim() };
      // Optional parts only when set, so an old funnel reads (and renders) exactly as before.
      const vars = (s.variations ?? [])
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, MAX_VARIATIONS);
      if (vars.length) out.variations = vars;
      if (s.ab) out.ab = true;
      if (s.autopilot === "auto") out.autopilot = "auto";
      return out;
    });
}

export function asCorrections(v: unknown): VoiceCorrection[] {
  return z
    .array(z.unknown())
    .catch([])
    .parse(v)
    .map((x) => CorrectionSchema.parse(x && typeof x === "object" ? x : {}))
    .filter((c) => c.body.trim());
}

export function asBusiness(v: unknown): SetterProfile["business"] {
  const b = BusinessSchema.parse(v && typeof v === "object" ? v : {});
  return {
    sections: Object.fromEntries(Object.entries(b.sections).map(([k, s]) => [k, s.trim()])),
    objections: b.objections.filter((o) => o.objection.trim() && o.response.trim()),
  };
}

export function asSettings(v: unknown): ClientSettings {
  return compact(SettingsSchema.parse(v && typeof v === "object" ? v : {})) as ClientSettings;
}

export function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

// ---------------------------------------------------------------- setter rows
/** The columns of a Setter row J needs (Prisma's row type is assignable). */
export interface SetterRowLike {
  id: string;
  name: string;
  autonomy: "APPROVE" | "AUTO";
  settings: unknown;
  business: unknown;
  offers: unknown;
  funnel: unknown;
  voice: string;
  voiceExamples: string;
  examples: string;
  voiceCorrections: unknown;
}

/** What J reads for one setter. The docs (SetterDoc rows) win where they
 *  exist; the JSON columns stay as the fallback for any doc that doesn't. */
export function profileFromRow(row: SetterRowLike, docs?: SetterDocs | null): SetterProfile {
  const base: SetterProfile = {
    name: row.name,
    settings: asSettings(row.settings),
    business: asBusiness(row.business),
    offers: asOffers(row.offers),
    funnel: asFunnel(row.funnel),
    voice: row.voice ?? "",
    voiceExamples: row.voiceExamples ?? "",
    examples: row.examples ?? "",
    voiceCorrections: asCorrections(row.voiceCorrections),
  };
  if (!docs) return base;
  const d = profilePartsFromDocs(docs);
  const out: SetterProfile = { ...base, business: { ...base.business } };
  if (d.persona !== undefined) out.persona = d.persona;
  if (d.voice !== undefined) out.voice = d.voice;
  if (d.voiceExamples !== undefined) out.voiceExamples = d.voiceExamples;
  if (d.sections) out.business.sections = asBusiness({ sections: d.sections }).sections;
  if (d.objections) out.business.objections = asBusiness({ objections: d.objections }).objections;
  if (d.offers) out.offers = asOffers(d.offers);
  if (d.examples !== undefined) out.examples = d.examples;
  return out;
}

/** A profile as Setter columns (import, duplicate). */
export function rowDataFromProfile(p: SetterProfile) {
  return {
    name: p.name,
    settings: p.settings as Record<string, unknown>,
    business: p.business as unknown as Record<string, unknown>,
    offers: p.offers as unknown as Record<string, unknown>[],
    funnel: p.funnel as unknown as Record<string, unknown>[],
    voice: p.voice,
    voiceExamples: p.voiceExamples,
    examples: p.examples,
    voiceCorrections: p.voiceCorrections as unknown as Record<string, unknown>[],
  };
}

// ---------------------------------------------------------------- resources
export type ResourceStatusName = "ACTIVE" | "TEST" | "DRAFT";

export interface ResourceLike {
  id: string;
  slug: string;
  kind: string;
  name: string;
  link: string | null;
  keyword: string | null;
  status: ResourceStatusName;
  description: string;
  data: unknown;
}

export interface ResourceInput {
  slug: string;
  kind: string;
  name: string;
  link: string | null;
  keyword: string | null;
  status: ResourceStatusName;
  description: string;
  data: Record<string, unknown>;
}

export function statusFromCatalog(s: string | undefined): ResourceStatusName {
  const v = (s ?? "").toLowerCase();
  return v === "active" ? "ACTIVE" : v === "test" ? "TEST" : "DRAFT";
}

/** One resources.json row → Resource columns. Fields with a column are lifted
 *  out; everything else (triggers, zernio/dm copy, opener, match…) stays in data. */
export function resourceFromCatalog(row: CatalogRow): ResourceInput {
  const { slug, type, name, status, resource_url, for_setter, ...rest } = row;
  const keyword = row.triggers?.find((t) => t.keyword)?.keyword ?? row.zernio?.keyword ?? null;
  return {
    slug,
    kind: type === "setter" ? "setter" : "resource",
    name: name || slug,
    link: resource_url || null,
    keyword: keyword || null,
    status: statusFromCatalog(status),
    description: for_setter ?? "",
    data: rest as Record<string, unknown>,
  };
}

/** A Resource row → the catalog row J's matching code reads. */
export function catalogRowFromResource(r: ResourceLike): CatalogRow {
  const data = (r.data && typeof r.data === "object" ? r.data : {}) as Partial<CatalogRow>;
  const row: CatalogRow = {
    ...data,
    slug: r.slug,
    type: r.kind === "setter" ? "setter" : "resource",
    name: r.name,
    status: r.status.toLowerCase(),
    for_setter: r.description || undefined,
  };
  if (r.link) row.resource_url = r.link;
  else delete row.resource_url;
  const kw = (r.keyword ?? "").trim();
  if (kw) {
    const triggers: CatalogTrigger[] = [...(data.triggers ?? [])];
    if (!triggers.some((t) => (t.keyword ?? "").toLowerCase() === kw.toLowerCase())) {
      triggers.push({ surface: r.kind === "setter" ? "dm" : "comment", post_id: null, keyword: kw, automation_id: null });
    }
    row.triggers = triggers;
  }
  return row;
}

// ---------------------------------------------------------------- what J reads
export interface ResolvedSetter {
  /** "files" = the bundled markdown fallback (workspace has no Setter row). */
  source: "db" | "files";
  setterId: string | null;
  autonomy: "approve" | "auto";
  profile: SetterProfile;
  /** Every row: what J recognises in a thread (what they were sent, entry paths). */
  catalog: Catalog;
  /** Entry rows + only the lead magnets this setter may offer (the brand block). */
  offered: Catalog;
}

export interface KnowledgeSource {
  forContact(contact: SetterContact): Promise<ResolvedSetter>;
  forSetter(workspaceId: string, setterId: string): Promise<ResolvedSetter | null>;
}

export interface ResolveExtras {
  docs?: SetterDocs | null;
  /** Setup › Fields J fills. */
  fields?: FieldToFill[];
}

/** Best episodes: Resource rows of kind "episode", in the order given. */
export function episodesFrom(resources: ResourceLike[]): Episode[] {
  return resources
    .filter((r) => r.kind === "episode" && r.status === "ACTIVE" && r.link)
    .map((r) => {
      const d = (r.data && typeof r.data === "object" ? r.data : {}) as { when?: unknown };
      return { name: r.name, link: r.link ?? "", when: typeof d.when === "string" ? d.when : r.description };
    });
}

export function resolvedFromRows(
  setter: SetterRowLike,
  allResources: ResourceLike[],
  enabledResourceIds: Iterable<string>,
  extras: ResolveExtras = {}
): ResolvedSetter {
  const profile = profileFromRow(setter, extras.docs);
  const episodes = episodesFrom(allResources);
  if (episodes.length) profile.episodes = episodes;
  if (extras.fields?.length) profile.fields = extras.fields;
  // Episodes are their own block, never a lead magnet J matches on.
  const resources = allResources.filter((r) => r.kind !== "episode");
  const enabled = new Set(enabledResourceIds);
  const rows = resources.map((r) => ({ r, row: catalogRowFromResource(r) }));
  const tag_options = profile.settings.tag_options as string[] | undefined;
  return {
    source: "db",
    setterId: setter.id,
    autonomy: setter.autonomy === "AUTO" ? "auto" : "approve",
    profile,
    catalog: { tag_options, resources: rows.map((x) => x.row) },
    offered: { tag_options, resources: rows.filter((x) => x.r.kind === "setter" || enabled.has(x.r.id)).map((x) => x.row) },
  };
}
