// Pure mappers for importing J's old operations/dms/contacts.json (spec item
// 23) into Contact + SetterState. The record keeps the Python shape
// (lib/os/setter/state.ts), so it is copied as-is minus the runtime caches.

import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { kindForEntry } from "@/lib/os/contacts";
import type { SetterRecord } from "@/lib/os/setter/state";
import { zernioTagEffects } from "@/lib/os/import/leadflow";

export interface ContactsFile {
  version: number;
  contacts: Record<string, SetterRecord & Record<string, unknown>>;
}

/** Python-only caches the TS port re-reads from Zernio every pass. */
const DROP = ["thread", "url", "updated_time"];

export function cleanRecord(raw: SetterRecord & Record<string, unknown>): SetterRecord {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!DROP.includes(k)) out[k] = v;
  return out as unknown as SetterRecord;
}

/** J's entry.via → our Contact.entryPath (lib/os/labels.ts entryLabels). */
export function entryPathFor(via: string | null | undefined): string | null {
  switch (via) {
    case "post_keyword":
      return "comment";
    case "setter_comment":
      return "setter_comment";
    case "story_keyword":
      return "story_reply";
    case "dm_keyword":
    case "setter_keyword":
      return "keyword_dm";
    default:
      return null;
  }
}

export interface SetterContactFields {
  entryPath: string | null;
  kind: ContactKind | null;
  stage: ContactStage | null;
  paused: boolean;
  tags: string[];
}

/**
 * What a J record says about its contact. Kind comes from the entry (keyword
 * entries are sales) unless a Zernio control tag says otherwise; client → Won,
 * agent_paused → paused.
 */
export function contactFieldsFor(rec: SetterRecord): SetterContactFields {
  const entryPath = entryPathFor(rec.entry?.via);
  const fx = zernioTagEffects(rec.tags ?? []);
  const entryKind = kindForEntry(entryPath);
  return {
    entryPath,
    kind: fx.kind ?? (entryKind === "SALES" ? "SALES" : null),
    stage: fx.stage ?? null,
    paused: Boolean(fx.paused),
    tags: rec.tags ?? [],
  };
}

export function nextAction(rec: SetterRecord): { nextActionKind: string | null; nextActionAt: Date | null } {
  const kind = rec.next_action?.kind;
  return {
    nextActionKind: kind && kind !== "none" ? kind : null,
    nextActionAt: rec.next_action?.at ? new Date(rec.next_action.at) : null,
  };
}

/** Stable JSON for "is the stored record already this one". */
export function sameRecord(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export type StateDecision = "create" | "update" | "unchanged" | "kept-live";

/**
 * Whether to write J's imported record over the stored SetterState. J (the TS
 * port) may already have run on this contact: once its state moved on past
 * the last import, the live one wins.
 */
export function decideState(
  existing: { record: unknown; updatedAt: Date } | null,
  rec: SetterRecord,
  lastImportAt: string | null | undefined,
): StateDecision {
  if (!existing) return "create";
  if (sameRecord(existing.record, rec)) return "unchanged";
  if (lastImportAt && existing.updatedAt.getTime() <= new Date(lastImportAt).getTime() + 5000) return "update";
  return "kept-live";
}
