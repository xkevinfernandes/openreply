// The engine's shapes: runs as the engine sees them, the store it keeps them
// in, and the ports it talks to the world through (contacts, sending, J, the
// clock). The engine itself (engine.ts) is IO-free apart from these, so the
// tests drive it with a memory store, a fake clock, a fake Zernio and a fake J.

import type { RunStatus, WorkflowMode } from "@/lib/os/workflows/api";
import type { SetterExit, WorkflowGraph } from "@/lib/os/workflows/graph";

export type { RunStatus, WorkflowMode };

export type TriggerKind = "comment" | "story_reply" | "dm" | "goto";

export interface TriggerInfo {
  kind: TriggerKind;
  keyword?: string | null;
  commentId?: string | null;
  postId?: string | null;
  mid?: string | null;
  text?: string | null;
  /** Go to: the run it replaced. */
  fromRunId?: string | null;
}

export type ReleaseRule = "R1" | "R2" | "R3" | "R4" | "R5";

/** A release (or the second-resource nudge) J has been asked to write. */
export interface PendingDirective {
  kind: "release" | "nudge";
  rule: ReleaseRule | null;
  slugs: string[];
  at: string;
}

/** What a Setter step remembers for one run. */
export interface SetterRunState {
  nodeId?: string;
  /** Resources J is holding (slugs). E5 adds to it. */
  held: string[];
  /** Resources that went out (by J, a step or Kevin by hand). */
  released: string[];
  /** Times they asked for the resource directly (R4 at 2). */
  asks: number;
  /** One-word / low-effort replies in a row (R3 at 2). */
  lowEffort: number;
  /** Real replies inside the step (Start a conversation: goal met at 2). */
  replies: number;
  /** The goal right now: R3 / R5 move Book a call to Start a conversation. */
  goal?: "book_call" | "start_conversation";
  releaseRule?: ReleaseRule | null;
  /** J asked to write this (cleared when it went out). */
  directive?: PendingDirective | null;
  /** The second-resource nudge was used (Q1: once). */
  nudged?: boolean;
  /** Short notes for J ("commented SETTER again", "also asked for X"). */
  notes: string[];
  /** When the quiet release (R2) is due, chosen once per silence. */
  quietAt?: string | null;
  /** Their message the quiet timer was set from. */
  quietFrom?: string | null;
  /** J or Kevin marked them (R5 / exits). */
  notFit?: boolean;
  /** Leave by this exit once the release (R1 / R5) went out. */
  pendingExit?: "booked" | "not_a_fit" | null;
}

/** Step progress for one run. */
export interface RunStepState {
  /** The node whose entry actions already ran. */
  entered?: string | null;
  /** Bubbles of the current Message step already sent. */
  bubble?: number;
  /** Comment trigger: only the private reply may go until they answer. */
  gate?: boolean;
  /** Ask / quick replies: the retry line went out. */
  askRetried?: boolean;
  /** Condition follows: checks so far. */
  followChecks?: number;
  /** Other workflows triggered while this run was before its Setter step (E6). */
  pending?: { workflowId: string; keyword: string | null; trigger: TriggerInfo }[];
  /** E3: public replies sent on repeat comments (spam guard). */
  repeats?: number;
  /** Last public reply text, so a repeat gets a different one. */
  lastPublicReply?: string | null;
  /** Why the run is blocked right now (cap, Pause all, window). */
  blocked?: string | null;
  /** A to-do was already made for this block. */
  blockedTodo?: boolean;
  /** Their last DM / tap as the engine saw it (the 24h window). */
  theirLastAt?: string | null;
  /** Our last send from this run (steps and J). */
  lastSentAt?: string | null;
  /** Who wrote last in this run: they owe us a reply ("us") or we owe them ("them"). */
  lastFrom?: "us" | "them" | null;
  /** The comment's one private reply went out. */
  privateSent?: boolean;
  /** E4: the old link was re-sent once on a blocked re-entry. */
  resent?: boolean;
  /** The status before Kevin paused it. */
  pausedFrom?: string | null;
}

export interface RunRecord {
  id: string;
  workspaceId: string;
  workflowId: string;
  versionId: string;
  instagramAccountId: string;
  igUserId: string;
  contactId: string | null;
  status: RunStatus;
  currentNodeId: string | null;
  waitUntil: Date | null;
  waitingFor: string | null;
  keyword: string | null;
  trigger: TriggerInfo;
  setter: SetterRunState;
  state: RunStepState;
  pausedAt: Date | null;
  pausedReason: string | null;
  exit: string | null;
  failReason: string | null;
  attempts: number;
  startedAt: Date;
  endedAt: Date | null;
}

export const LIVE_STATUSES: RunStatus[] = ["active", "waiting", "paused"];
export const isLive = (s: RunStatus) => LIVE_STATUSES.includes(s);

export interface WorkflowDef {
  id: string;
  workspaceId: string;
  instagramAccountId: string | null;
  name: string;
  mode: WorkflowMode;
  active: boolean;
  currentVersionId: string | null;
}

export interface VersionDef {
  id: string;
  workflowId: string;
  number: number;
  graph: WorkflowGraph;
  keywords: string[];
}

export interface NewRun {
  workspaceId: string;
  workflowId: string;
  versionId: string;
  instagramAccountId: string;
  igUserId: string;
  contactId: string | null;
  keyword: string | null;
  trigger: TriggerInfo;
  currentNodeId: string | null;
  startedAt: Date;
}

export interface RunEventInput {
  run: Pick<RunRecord, "id" | "workspaceId" | "workflowId" | "versionId">;
  nodeId: string;
  kind: "enter" | "leave" | "replied" | "released" | "booked" | "showed" | "sent" | "failed" | "note";
  port?: string | null;
  data?: Record<string, unknown>;
  at: Date;
}

export interface RunEventRow extends Omit<RunEventInput, "run"> {
  runId: string;
  workflowId: string;
  versionId: string;
}

export interface WorkflowStore {
  /** Active workflows with a published version, for one IG account. */
  liveWorkflows(workspaceId: string, instagramAccountId: string): Promise<{ wf: WorkflowDef; version: VersionDef }[]>;
  workflow(id: string): Promise<WorkflowDef | null>;
  version(id: string): Promise<VersionDef | null>;
  liveRun(instagramAccountId: string, igUserId: string): Promise<RunRecord | null>;
  liveRunForContact(contactId: string): Promise<RunRecord | null>;
  /** Runs of this person, newest first (optionally one workflow / keyword / since). */
  runsOf(instagramAccountId: string, igUserId: string, opts?: { workflowId?: string; keyword?: string; since?: Date }): Promise<RunRecord[]>;
  /** Null when the person already has a live run (one at a time). */
  createRun(input: NewRun): Promise<RunRecord | null>;
  saveRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  event(e: RunEventInput): Promise<void>;
  /** The sticky Randomizer branch; `pick` runs only for the first assignment. */
  assignment(key: { workspaceId: string; workflowId: string; nodeId: string; instagramAccountId: string; igUserId: string }, pick: () => string): Promise<string>;
  /** True the first time a key is seen (idempotent webhooks). */
  claimInbound(key: string, workspaceId: string): Promise<boolean>;
  /** Live runs whose timer is due. */
  dueRuns(now: Date, limit?: number): Promise<RunRecord[]>;
  /** Live runs (active, waiting, paused) of one workflow. */
  liveRunsOf(workflowId: string): Promise<RunRecord[]>;
  /** The workflow and everything that belongs to it: versions, runs, their events, Randomizer branches. */
  deleteWorkflow(workflowId: string): Promise<void>;
  /**
   * A short lease on one run, so a tap and a timer never advance the same run
   * at once (the later save would undo the earlier one). Returns a token, or
   * null while someone else holds it. The lease ends by itself after ttlMs.
   */
  lockRun(runId: string, ttlMs: number): Promise<string | null>;
  unlockRun(runId: string, token: string): Promise<void>;
}

// ---------------------------------------------------------------- ports
export type ContactKindName = "SALES" | "PERSONAL" | "UNSORTED" | "PITCHES";

export interface ContactInfo {
  id: string;
  workspaceId: string;
  instagramAccountId: string;
  igUserId: string;
  kind: ContactKindName;
  paused: boolean;
  tags: string[];
  username: string | null;
  fullName: string | null;
  stage: string | null;
  setterStage: string | null;
  /** Their last message (opens Instagram's 24h window). */
  theirLastAt: Date | null;
  conversationId: string | null;
}

export interface OutButton {
  id: string;
  label: string;
  payload: string;
}

/** One outgoing bubble. A link is always its own bubble. Buttons and quick replies never go together. */
export type OutMessage = { text: string; buttons?: OutButton[]; quickReplies?: OutButton[] } | { url: string } | { image: string };

export interface SendContext {
  workspaceId: string;
  instagramAccountId: string;
  igUserId: string;
  conversationId: string | null;
}

export type CanSend = "ok" | "paused" | "cap";

export interface ResourceInfo {
  slug: string;
  title: string;
  url: string;
}

export interface Classification {
  /** A one-word / low-effort reply ("ok", "cool", "yes"). */
  lowEffort: boolean;
  /** They asked for the resource directly ("just send it", "where's the link"). */
  askedForResource: boolean;
  /** "just send it" / "not ready": counts as not ready straight away. */
  notReady: boolean;
  /** Not a creator / no business / student. */
  notFit: boolean;
  /** Stop / unsubscribe / rude. */
  stop: boolean;
  /** "is this a bot?" */
  aiQuestion: boolean;
}

export interface JRequest {
  contactId: string;
  workspaceId: string;
  /** inbound: answer their message; timer: a release / nudge / resume; resume: after Kevin's Resume. */
  reason: "inbound" | "timer" | "resume";
  runId: string;
}

export interface Ports {
  now(): Date;
  random(): number;
  contact(workspaceId: string, instagramAccountId: string, igUserId: string, create?: { username?: string | null; entryPath?: string | null }): Promise<ContactInfo | null>;
  setPaused(contactId: string, paused: boolean): Promise<void>;
  writeField(workspaceId: string, contactId: string, key: string, value: string, ref: string): Promise<boolean>;
  hasField(contactId: string, key: string): Promise<boolean>;
  addTag(workspaceId: string, contactId: string, tag: string): Promise<void>;
  removeTag(workspaceId: string, contactId: string, tag: string): Promise<void>;
  markStopped(workspaceId: string, contactId: string): Promise<void>;
  friday(workspaceId: string, contactId: string): Promise<void>;
  publicReply(ctx: SendContext, commentId: string, postId: string | null, text: string): Promise<void>;
  /** The one private reply to a comment (the opener). Never blocked by the cap (speed to lead). */
  privateReply(ctx: SendContext, commentId: string, postId: string | null, msg: OutMessage): Promise<void>;
  /** A DM. The caller checked canSend. */
  dm(ctx: SendContext, msg: OutMessage, opts: { humanAgent: boolean; key: string }): Promise<void>;
  canSend(workspaceId: string, n: number): Promise<CanSend>;
  /** Start of the next local day (when the cap resets). */
  nextCapReset(workspaceId: string): Promise<Date>;
  follows(ctx: SendContext): Promise<boolean | null>;
  resource(workspaceId: string, slug: string): Promise<ResourceInfo | null>;
  /** Queue J's turn for this contact (the setter queue; J reads the step). */
  requestJ(req: JRequest): Promise<void>;
  /** A J draft waits in the Inbox for this contact. */
  pendingJDraft(contactId: string): Promise<boolean>;
  classify(text: string, ctx: { held: string[]; history: string[] }): Promise<Classification>;
  /**
   * A typed answer to quick replies: which option they meant, or null
   * ("none"). The same model J's classifier uses; null when there's no model.
   */
  pickOption(text: string, ctx: { question: string; options: { id: string; label: string }[] }): Promise<string | null>;
  todo(workspaceId: string, contactId: string, key: string, title: string, context: Record<string, unknown>): Promise<void>;
  /** Wake the run at this time (a delayed job). */
  schedule(runId: string, at: Date): Promise<void>;
  /** A live OpenReply campaign answers this comment / DM itself (O4). */
  campaignOwns(workspaceId: string, instagramAccountId: string, ev: { surface: "comment" | "dm"; text: string; postId?: string | null }): Promise<boolean>;
}

export interface EngineDeps {
  store: WorkflowStore;
  ports: Ports;
}

export type ExitName = SetterExit;
