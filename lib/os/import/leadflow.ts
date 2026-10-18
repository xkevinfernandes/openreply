// Pure mappers for the one-time Lead Flow import (spec item 22). No IO: the
// export script builds a LeadFlowExport file, the import script feeds its rows
// through these and writes what they return.

import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";

// ---------------------------------------------------------------- file shape
export interface LeadFlowTouch {
  id: string;
  type: string;
  at: number;
  loggedBy?: string;
  voids?: string;
}

export interface LeadFlowPerson {
  id: string;
  handle: string;
  fullName?: string;
  igPk?: string;
  email?: string;
  tags?: string[];
  notes?: string;
  type?: string;
  verdict?: string;
  verdictReason?: string;
  crm?: Record<string, unknown>;
  zernioConversationId?: string;
  zernioParticipantId?: string;
  /** personStats.stage (the Rules cache), for cross-checking. */
  cachedStage?: string;
  /** Pipeline touches only (first_dm … lost, reopened, void). */
  touches: LeadFlowTouch[];
  createdAt: number;
}

export interface ExportConversation {
  conversationId: string;
  participantId: string | null;
  username: string;
  name?: string;
  updatedTime?: string;
}

export interface ZernioTagged {
  participantId: string;
  username?: string;
  tags: string[];
}

export interface LeadFlowExport {
  version: 1;
  exportedAt: string;
  source: { leadflowDeployment?: string; zernioAccount?: string };
  people: LeadFlowPerson[];
  /** Lead Flow's zernioConversations plus a live Zernio pull, by conversationId. */
  conversations: ExportConversation[];
  /** Zernio contacts carrying client / friend / agent_paused. */
  zernioTags: ZernioTagged[];
  /** How many Lead Flow people were left out (story viewers only). */
  skippedStoryViewers: number;
}

// ---------------------------------------------------------------- stage
// Port of Lead Flow lib/rules/pipeline.ts fold(): the stage a person's
// touches make.
export const LF_STAGES = [
  "messaged", "in_conversation", "call_offered", "booked", "showed", "no_show", "pitched", "won", "lost",
] as const;
export type LeadFlowStage = (typeof LF_STAGES)[number];

const STAGE_OF: Record<string, LeadFlowStage> = {
  first_dm: "messaged", reply: "in_conversation", offer: "call_offered", booked: "booked", showed: "showed",
  no_show: "no_show", pitched: "pitched", won: "won", lost: "lost",
};
const RANK: Record<string, number> = {
  first_dm: 1, reply: 2, offer: 3, booked: 4, showed: 5, no_show: 5, pitched: 6, won: 7, lost: 7, reopened: 8,
};
const CALL_OFFERED = LF_STAGES.indexOf("call_offered");

export function activeTouches(touches: readonly LeadFlowTouch[]): LeadFlowTouch[] {
  const voided = new Set(touches.filter((t) => t.type === "void" && t.voids).map((t) => t.voids));
  return touches.filter((t) => t.type !== "void" && !voided.has(t.id));
}

export function leadFlowStage(touches: readonly LeadFlowTouch[]): LeadFlowStage | null {
  const ms = activeTouches(touches)
    .filter((t) => t.type in RANK)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.at - b.t.at || RANK[a.t.type] - RANK[b.t.type] || a.i - b.i)
    .map((x) => x.t);
  let from = 0;
  ms.forEach((m, i) => {
    if (m.type === "reopened") from = i;
  });
  let stage: LeadFlowStage | null = null;
  for (const m of ms.slice(from)) {
    if (m.type === "reopened") {
      stage = "in_conversation";
      continue;
    }
    if (m.type === "reply" && stage !== null && LF_STAGES.indexOf(stage) >= CALL_OFFERED) continue;
    stage = STAGE_OF[m.type];
  }
  return stage;
}

/** Lead Flow pipeline stage (or the old sheet's crm.stage) → our Kanban column. */
export function mapStage(stage: string | null | undefined): ContactStage | null {
  switch ((stage ?? "").toLowerCase().replace(/[\s-]+/g, "_")) {
    case "messaged":
    case "contacted":
    case "sent":
      return "NEW";
    case "in_conversation":
    case "replied":
    case "talking":
      return "IN_CONVERSATION";
    case "call_offered":
      return "CALL_OFFERED";
    case "booked":
    case "no_show":
      return "CALL_BOOKED";
    case "showed":
    case "pitched":
      return "SHOWED";
    case "won":
      return "WON";
    case "lost":
      return "LOST";
    default:
      return null;
  }
}

/** Tags that keep the detail our columns drop (No-show, Pitched). */
export function stageTags(stage: string | null | undefined): string[] {
  if (stage === "no_show") return ["no_show"];
  if (stage === "pitched") return ["pitched"];
  return [];
}

/** The person's Lead Flow stage: touches first, then the cache, then the sheet. */
export function personStage(p: LeadFlowPerson): string | null {
  const crmStage = typeof p.crm?.stage === "string" ? p.crm.stage : null;
  return leadFlowStage(p.touches) ?? p.cachedStage ?? crmStage;
}

// ---------------------------------------------------------------- kind
export function isFriendType(type: string | null | undefined): boolean {
  return /^friend/i.test(type ?? "") || /^peer$/i.test(type ?? "");
}

/** Lead Flow's own view: friends/peers are personal, anyone in the pipeline is sales. */
export function mapKind(p: LeadFlowPerson): ContactKind | null {
  if (isFriendType(p.type)) return "PERSONAL";
  if (!p.type && p.verdict === "peer") return "PERSONAL";
  if (personStage(p)) return "SALES";
  if (p.type === "prospect") return "SALES";
  return null;
}

/** Worth importing: anything beyond story-viewer data (spec item 22). */
export function isCandidate(p: LeadFlowPerson): boolean {
  return Boolean(
    p.zernioConversationId ||
      p.zernioParticipantId ||
      personStage(p) ||
      p.email ||
      (p.tags && p.tags.length) ||
      p.notes ||
      isFriendType(p.type),
  );
}

// ---------------------------------------------------------------- Zernio tags
export const CONTROL_TAGS = ["client", "friend", "agent_paused"];

export interface TagEffects {
  kind?: ContactKind;
  stage?: ContactStage;
  paused?: boolean;
}

/** Spec item 7: client → Won (and sales), friend → personal, agent_paused → paused. */
export function zernioTagEffects(tags: readonly string[]): TagEffects {
  const t = new Set(tags.map((x) => x.toLowerCase()));
  const out: TagEffects = {};
  if (t.has("client")) {
    out.stage = "WON";
    out.kind = "SALES";
  } else if (t.has("friend")) {
    out.kind = "PERSONAL";
  }
  if (t.has("agent_paused")) out.paused = true;
  return out;
}

// ---------------------------------------------------------------- merge
export interface ImportStamp {
  at: string;
  /** The stage / kind this import wrote, while the contact still has it. */
  stage: ContactStage | null;
  kind: ContactKind | null;
  /** Lead Flow people._id (leadflow) or the Zernio conversation id (setter). */
  sourceId: string;
}

export interface ImportedMeta {
  leadflow?: ImportStamp;
  setter?: ImportStamp;
}

export interface ExistingContact {
  kind: ContactKind;
  kindSource: string | null;
  stage: ContactStage;
  tags: string[];
  notes: string | null;
  email: string | null;
  username: string | null;
  fullName: string | null;
  zernioConversationId: string | null;
  paused: boolean;
  imported: ImportedMeta | null;
}

export interface Incoming {
  /** "leadflow" or "setter": which slot of `imported` this run owns. */
  source: "leadflow" | "setter";
  sourceId: string;
  kind?: ContactKind | null;
  stage?: ContactStage | null;
  tags?: string[];
  /** Text to append under the "From Lead Flow:" prefix. */
  note?: string | null;
  email?: string | null;
  username?: string | null;
  fullName?: string | null;
  zernioConversationId?: string | null;
  paused?: boolean;
}

export interface MergeResult {
  data: {
    kind?: ContactKind;
    kindSource?: string;
    stage?: ContactStage;
    tags?: string[];
    notes?: string;
    email?: string;
    username?: string;
    fullName?: string;
    zernioConversationId?: string;
    paused?: boolean;
    imported: ImportedMeta;
  };
  /** Fields that changed (the meta stamp aside); empty = no-op. */
  changed: string[];
  conflicts: string[];
}

export const NOTE_PREFIX = "From Lead Flow:";

export function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

/**
 * How an import merges into a contact. `existing` null = new contact (the
 * caller creates it with these fields). Rules:
 *  - kind: never over a user decision (kindSource "user"), nor over one that
 *    changed since the last import wrote it, nor over one the other import
 *    (Lead Flow vs J's contacts.json) wrote: the first source wins.
 *  - stage: only while it is still the default (NEW, never imported) or still
 *    equals what the last import wrote; otherwise it is a conflict and kept.
 *  - tags union; notes appended once; email/handle/name/thread filled if empty.
 */
export function mergeContact(existing: ExistingContact | null, inc: Incoming, now: Date): MergeResult {
  const prevMeta: ImportedMeta = existing?.imported ?? {};
  const prev = prevMeta[inc.source];
  const data: MergeResult["data"] = { imported: prevMeta };
  const changed: string[] = [];
  const conflicts: string[] = [];
  const stamps = Object.values(prevMeta).filter(Boolean) as ImportStamp[];

  // kind
  const curKind = existing?.kind ?? "UNSORTED";
  if (inc.kind && curKind !== inc.kind) {
    const curSource = existing?.kindSource ?? null;
    // An import stamp that no longer matches = the user changed it since.
    const changedSince = curSource === "import" && stamps.length > 0 && !stamps.some((st) => st.kind === curKind);
    // The other import wrote this kind and still owns it: first source wins.
    const otherOwns =
      curSource === "import" &&
      Object.entries(prevMeta).some(([src, st]) => src !== inc.source && st?.kind === curKind);
    if (curSource === "user" || changedSince) {
      conflicts.push(`kind: kept ${curKind} (set in the DM OS), import says ${inc.kind}`);
    } else if (otherOwns) {
      conflicts.push(`kind: kept ${curKind} (from the earlier import), this import says ${inc.kind}`);
    } else {
      data.kind = inc.kind;
      data.kindSource = "import";
      changed.push("kind");
    }
  }

  // stage
  const curStage = existing?.stage ?? "NEW";
  if (inc.stage && curStage !== inc.stage) {
    const untouched =
      existing === null ||
      (curStage === "NEW" && !stamps.some((st) => st.stage)) ||
      stamps.some((st) => st.stage === curStage);
    if (!untouched) conflicts.push(`stage: kept ${curStage} (changed in the DM OS), import says ${inc.stage}`);
    else {
      data.stage = inc.stage;
      changed.push("stage");
    }
  }

  // tags
  const curTags = existing?.tags ?? [];
  const tags = uniq([...curTags, ...(inc.tags ?? [])]);
  if (tags.length !== curTags.length) {
    data.tags = tags;
    changed.push("tags");
  }

  // notes
  if (inc.note && inc.note.trim()) {
    const block = `${NOTE_PREFIX} ${inc.note.trim()}`;
    const curNotes = existing?.notes ?? "";
    if (!curNotes.includes(block)) {
      data.notes = curNotes ? `${curNotes.trimEnd()}\n\n${block}` : block;
      changed.push("notes");
    }
  }

  // plain fields: fill when empty
  for (const f of ["email", "username", "fullName", "zernioConversationId"] as const) {
    const v = inc[f];
    if (!v) continue;
    const cur = existing?.[f] ?? null;
    if (!cur) {
      data[f] = v;
      changed.push(f);
    } else if (f === "email" && cur.toLowerCase() !== v.toLowerCase()) {
      conflicts.push(`email: kept ${cur}, import says ${v}`);
    }
  }

  if (inc.paused && !existing?.paused) {
    data.paused = true;
    changed.push("paused");
  }

  // What this import "owns": the value it wrote, while the contact still has it.
  const finalStage = data.stage ?? curStage;
  const finalKind = data.kind ?? curKind;
  data.imported = {
    ...prevMeta,
    [inc.source]: {
      at: now.toISOString(),
      sourceId: inc.sourceId,
      stage: inc.stage && finalStage === inc.stage ? inc.stage : (prev?.stage ?? null),
      kind: inc.kind && finalKind === inc.kind ? inc.kind : (prev?.kind ?? null),
    },
  };
  return { data, changed, conflicts };
}

/** The "From Lead Flow:" note body for one person (notes + verdict). */
export function leadFlowNote(p: LeadFlowPerson): string | null {
  const parts: string[] = [];
  if (p.notes?.trim()) parts.push(p.notes.trim());
  if (p.verdict) parts.push(`verdict ${p.verdict}${p.verdictReason ? ` (${p.verdictReason})` : ""}`);
  return parts.length ? parts.join("\n") : null;
}

// ---------------------------------------------------------------- identity
export interface Resolved {
  igUserId: string | null;
  conversationId: string | null;
  via: "participant" | "conversation" | "handle" | null;
}

/** Contact.igUserId = Zernio participantId. Falls back to the thread, then the handle. */
export function resolveIdentity(
  p: Pick<LeadFlowPerson, "handle" | "zernioConversationId" | "zernioParticipantId">,
  byConversation: Map<string, ExportConversation>,
  byHandle: Map<string, ExportConversation[]>,
): Resolved {
  if (p.zernioParticipantId) {
    return { igUserId: p.zernioParticipantId, conversationId: p.zernioConversationId ?? null, via: "participant" };
  }
  if (p.zernioConversationId) {
    const c = byConversation.get(p.zernioConversationId);
    if (c?.participantId) return { igUserId: c.participantId, conversationId: c.conversationId, via: "conversation" };
  }
  const hits = (byHandle.get(normHandle(p.handle)) ?? []).filter((c) => c.participantId);
  const ids = uniq(hits.map((c) => c.participantId as string));
  if (ids.length === 1) return { igUserId: ids[0], conversationId: hits[0].conversationId, via: "handle" };
  return { igUserId: null, conversationId: null, via: null };
}

export function normHandle(h: string | null | undefined): string {
  return (h ?? "").trim().replace(/^@/, "").toLowerCase();
}

export function indexConversations(convs: readonly ExportConversation[]) {
  const byConversation = new Map<string, ExportConversation>();
  const byHandle = new Map<string, ExportConversation[]>();
  for (const c of convs) {
    byConversation.set(c.conversationId, c);
    const k = normHandle(c.username);
    if (!k) continue;
    byHandle.set(k, [...(byHandle.get(k) ?? []), c]);
  }
  return { byConversation, byHandle };
}
