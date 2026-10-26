// The DM CRM funnel (dm-crm issues 031/032), shared by Home's funnel and the
// Pipeline screen's "All · funnel" board, so the two can never disagree.
//
// Cohort: contacts created in the last 7, 30 or 90 days (one stored switch,
// per browser: FUNNEL_WINDOW_KEY). Who is counted: Sales and Unsorted only;
// Personal, Pitches and spam left out; archived counted; imports left out of
// the cohort. Each step counts people who reached it or any later one, so no
// step exceeds the one before:
//
//   DMs in        created in the window
//   Replied       conversation_started (the episode rule, lib/os/metrics.ts)
//   Qualified     stage log reached the setter's qualify column or later, or
//                 the stage is (past) qualified / call offered, or a later event
//   Call offered  offer_made     Booked  call_booked     Showed  showed
//   Won           on Won now (Won → Lost drops them from Won and revenue)
//
// Revenue "From this cohort": Won amounts of the cohort on Won now. "Closed in
// period": Won amounts whose wonAt is in the window, whoever (counted, on Won
// now). Wins with no amount are listed, never hidden.

import { columnFor, funnelColumns, funnelKeyFor, type FunnelColumn, type FunnelStageLike } from "@/lib/os/funnel";

export const FUNNEL_WINDOWS = [7, 30, 90] as const;
export type FunnelWindow = (typeof FUNNEL_WINDOWS)[number];
export const DEFAULT_FUNNEL_WINDOW: FunnelWindow = 30;
/** localStorage key for the 7/30/90 switch Home and the All board share. */
export const FUNNEL_WINDOW_KEY = "os_funnel_window";

export function parseFunnelWindow(v: unknown): FunnelWindow {
  const n = Number(v);
  return (FUNNEL_WINDOWS as readonly number[]).includes(n) ? (n as FunnelWindow) : DEFAULT_FUNNEL_WINDOW;
}

export const FUNNEL_STEPS = [
  { key: "dms_in", label: "DMs in" },
  { key: "replied", label: "Replied" },
  { key: "qualified", label: "Qualified" },
  { key: "call_offered", label: "Call offered" },
  { key: "booked", label: "Booked" },
  { key: "showed", label: "Showed" },
  { key: "won", label: "Won" },
] as const;
export type FunnelStepKey = (typeof FUNNEL_STEPS)[number]["key"];
/** The All board's columns: the steps, then Lost. */
export type FunnelBoardColumn = FunnelStepKey | "lost";

/** Subtitle on Home and the All board's column tooltip (same words on both). */
export function cohortLabel(window: FunnelWindow): string {
  return `People who first DMed or commented in the last ${window} days`;
}

/** Everything the funnel needs about one contact. */
export interface FunnelContact {
  id: string;
  createdAt: Date;
  kind: "SALES" | "PERSONAL" | "UNSORTED" | "PITCHES";
  kindSource: string | null;
  entryPath: string | null;
  spam: boolean;
  spamOverride: boolean | null;
  archivedAt: Date | null;
  stage: Parameters<typeof columnFor>[0]["stage"];
  setterStage: string | null;
  attendance: "SHOWED" | "NO_SHOW" | null;
  /** The contact's setter's board columns. */
  columns: FunnelColumn[];
  /** OsEvent kinds recorded for them. */
  events: ReadonlySet<string>;
  /** Board column keys the stage log shows they reached (applied rows). */
  loggedColumns: ReadonlySet<string>;
  /** From the won event's data. */
  wonAmount: number | null;
  wonAt: Date | null;
}

const DAY = 86_400_000;

export function windowStart(window: FunnelWindow, now: Date): Date {
  return new Date(now.getTime() - window * DAY);
}

/** Spam as the inbox shows it: Kevin's sticky override wins. */
export function isSpam(c: Pick<FunnelContact, "spam" | "spamOverride">): boolean {
  return c.spamOverride ?? c.spam;
}

/** Sales and Unsorted, not spam (archived counted). */
export function isCounted(c: Pick<FunnelContact, "kind" | "spam" | "spamOverride">): boolean {
  return (c.kind === "SALES" || c.kind === "UNSORTED") && !isSpam(c);
}

/** An import never shows as a spike of new people. */
export function isImport(c: Pick<FunnelContact, "kindSource" | "entryPath">): boolean {
  return c.kindSource === "import" || c.entryPath === "import";
}

export function inCohort(c: FunnelContact, window: FunnelWindow, now: Date): boolean {
  return isCounted(c) && !isImport(c) && c.createdAt >= windowStart(window, now) && c.createdAt <= now;
}

export function columnNow(c: FunnelContact): string {
  return columnFor({ stage: c.stage, setterStage: c.setterStage, attendance: c.attendance }, c.columns);
}

/** Columns at or after the setter's qualify column (outcomes except Lost). */
export function qualifiedColumns(columns: FunnelColumn[]): Set<string> {
  const funnel = columns.filter((c) => c.group === "funnel");
  const q = funnelKeyFor("qualify", columns);
  const from = q ? funnel.findIndex((c) => c.key === q) : funnel.length;
  return new Set([...funnel.slice(Math.max(0, from)).map((c) => c.key), "booked", "showed", "no_show", "won"]);
}

const PAST_QUALIFIED = new Set(["QUALIFIED", "CALL_OFFERED", "CALL_BOOKED", "SHOWED", "WON"]);

/** How far they got: the index of the furthest step reached (0 = DMs in). */
export function furthestStepIndex(c: FunnelContact): number {
  const col = columnNow(c);
  if (col === "won") return 6;
  if (c.events.has("showed")) return 5;
  if (c.events.has("call_booked")) return 4;
  if (c.events.has("offer_made")) return 3;
  const q = qualifiedColumns(c.columns);
  if (PAST_QUALIFIED.has(c.stage) || [...c.loggedColumns].some((k) => q.has(k))) return 2;
  if (c.events.has("conversation_started")) return 1;
  return 0;
}

/** Where a contact sits on the All · funnel board. */
export function boardColumn(c: FunnelContact): FunnelBoardColumn {
  const col = columnNow(c);
  if (col === "won") return "won";
  if (col === "lost") return "lost";
  return FUNNEL_STEPS[Math.min(furthestStepIndex(c), 5)].key;
}

export interface FunnelStepView {
  key: FunnelStepKey;
  label: string;
  /** People who reached this step or a later one. */
  count: number;
  /** Share of the step before (null on the first, or when it had nobody). */
  pctOfPrevious: number | null;
}

export interface FunnelView {
  window: FunnelWindow;
  cohort: number;
  steps: FunnelStepView[];
  revenue: {
    /** Won amounts of this window's cohort, on Won now. */
    fromCohort: number;
    /** Won amounts whose wonAt is in the window, whoever. */
    closedInPeriod: number;
    /** On Won now with no amount (cohort or closed in period), to fill in. */
    noAmount: string[];
  };
  /** "No one new in the last 30 days" when true. */
  empty: boolean;
}

/** Home's funnel. `contacts` = the counted contacts the loader read. */
export function funnelView(contacts: FunnelContact[], window: FunnelWindow, now: Date): FunnelView {
  const cohort = contacts.filter((c) => inCohort(c, window, now));
  const reached = FUNNEL_STEPS.map((_, i) => cohort.filter((c) => furthestStepIndex(c) >= i).length);
  const steps = FUNNEL_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    count: reached[i],
    pctOfPrevious: i === 0 || !reached[i - 1] ? null : Math.round((reached[i] / reached[i - 1]) * 100),
  }));
  const start = windowStart(window, now);
  const onWon = (c: FunnelContact) => isCounted(c) && columnNow(c) === "won";
  const fromCohort = cohort.filter((c) => columnNow(c) === "won" && c.wonAmount != null).reduce((s, c) => s + (c.wonAmount ?? 0), 0);
  const closed = contacts.filter((c) => onWon(c) && c.wonAmount != null && c.wonAt && c.wonAt >= start && c.wonAt <= now);
  const noAmount = [...new Set([...cohort.filter((c) => columnNow(c) === "won" && c.wonAmount == null).map((c) => c.id)])];
  return {
    window,
    cohort: cohort.length,
    steps,
    revenue: { fromCohort, closedInPeriod: closed.reduce((s, c) => s + (c.wonAmount ?? 0), 0), noAmount },
    empty: cohort.length === 0,
  };
}

export interface FunnelBoardView {
  window: FunnelWindow;
  columns: { key: FunnelBoardColumn; label: string; reached: number | null; pctReached: number | null; contactIds: string[] }[];
}

/**
 * The All · funnel board: each cohort contact once, in its column; "reached"
 * is exactly the funnel's count (archived included); the cards shown follow
 * the Archived filter, so "here" (contactIds.length) may differ.
 */
export function funnelBoard(contacts: FunnelContact[], window: FunnelWindow, now: Date, opts: { showArchived?: boolean } = {}): FunnelBoardView {
  const f = funnelView(contacts, window, now);
  const cohort = contacts.filter((c) => inCohort(c, window, now));
  const visible = cohort.filter((c) => opts.showArchived || !c.archivedAt);
  const ids = (key: FunnelBoardColumn) => visible.filter((c) => boardColumn(c) === key).map((c) => c.id);
  return {
    window,
    columns: [
      ...f.steps.map((s) => ({ key: s.key as FunnelBoardColumn, label: s.label, reached: s.count, pctReached: s.pctOfPrevious, contactIds: ids(s.key) })),
      { key: "lost", label: "Lost", reached: null, pctReached: null, contactIds: ids("lost") },
    ],
  };
}

// --- Loader -----------------------------------------------------------------------

/** Read the counted contacts the funnel and board need (cohort plus anyone won in the window). */
export async function loadFunnelContacts(workspaceId: string, window: FunnelWindow, now = new Date()): Promise<FunnelContact[]> {
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) return mockFunnelContacts(now);
  const { prisma } = await import("@/lib/db/client");
  const { funnelOfJson } = await import("@/lib/os/stage-writer");
  const { wonDataOf } = await import("@/lib/os/events");
  const start = windowStart(window, now);

  const wonInWindow = await prisma.osEvent.findMany({ where: { workspaceId, kind: "won", contactId: { not: null } }, select: { contactId: true, data: true } });
  const closedIds = wonInWindow
    .filter((e) => {
      const w = wonDataOf(e.data);
      return w?.wonAt && new Date(w.wonAt) >= start;
    })
    .map((e) => e.contactId!);

  const rows = await prisma.contact.findMany({
    where: { workspaceId, kind: { in: ["SALES", "UNSORTED"] }, OR: [{ createdAt: { gte: start, lte: now } }, { id: { in: closedIds } }] },
    select: {
      id: true,
      createdAt: true,
      kind: true,
      kindSource: true,
      entryPath: true,
      spam: true,
      spamOverride: true,
      archivedAt: true,
      stage: true,
      setterStage: true,
      setterId: true,
      instagramAccountId: true,
    },
  });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [setters, events, logs, bookings] = await Promise.all([
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, funnel: true, isDefault: true, instagramAccountId: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.osEvent.findMany({ where: { workspaceId, contactId: { in: ids }, kind: { in: ["conversation_started", "offer_made", "call_booked", "showed", "won"] } }, select: { contactId: true, kind: true, data: true } }),
    prisma.contactStageLog.findMany({ where: { workspaceId, contactId: { in: ids }, outcome: "applied" }, select: { contactId: true, toColumn: true } }),
    prisma.booking.findMany({ where: { workspaceId, contactId: { in: ids }, attendance: { not: null } }, orderBy: { createdAt: "desc" }, select: { contactId: true, attendance: true } }),
  ]);
  const columnsOf = (setterId: string | null, account: string): FunnelColumn[] => {
    const s =
      (setterId && setters.find((x) => x.id === setterId)) ||
      setters.find((x) => x.isDefault && x.instagramAccountId === account) ||
      setters.find((x) => x.isDefault) ||
      setters[0];
    return funnelColumns(funnelOfJson(s?.funnel) as FunnelStageLike[]);
  };
  const ev = new Map<string, Set<string>>();
  const won = new Map<string, { amount: number; wonAt: Date | null }>();
  for (const e of events) {
    ev.set(e.contactId!, (ev.get(e.contactId!) ?? new Set()).add(e.kind));
    if (e.kind === "won") {
      const w = wonDataOf(e.data);
      if (w) won.set(e.contactId!, { amount: w.amount, wonAt: w.wonAt ? new Date(w.wonAt) : null });
    }
  }
  const logged = new Map<string, Set<string>>();
  for (const l of logs) logged.set(l.contactId, (logged.get(l.contactId) ?? new Set()).add(l.toColumn));
  const att = new Map<string, "SHOWED" | "NO_SHOW">();
  for (const b of bookings) if (b.attendance && !att.has(b.contactId)) att.set(b.contactId, b.attendance);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    kind: r.kind,
    kindSource: r.kindSource,
    entryPath: r.entryPath,
    spam: r.spam,
    spamOverride: r.spamOverride,
    archivedAt: r.archivedAt,
    stage: r.stage,
    setterStage: r.setterStage,
    attendance: att.get(r.id) ?? null,
    columns: columnsOf(r.setterId, r.instagramAccountId),
    events: ev.get(r.id) ?? new Set(),
    loggedColumns: logged.get(r.id) ?? new Set(),
    wonAmount: won.get(r.id)?.amount ?? null,
    wonAt: won.get(r.id)?.wonAt ?? null,
  }));
}

/** OS_MOCK: the sample contacts as funnel input (events follow their stage). */
async function mockFunnelContacts(now: Date): Promise<FunnelContact[]> {
  const { mockThreads } = await import("@/lib/os/mock");
  const { mockCrmState } = await import("@/lib/os/mock-crm");
  const columns = funnelColumns(null);
  const byStage: Record<string, string[]> = {
    NEW: [],
    LEAD_MAGNET_SENT: [],
    IN_CONVERSATION: ["conversation_started"],
    QUALIFIED: ["conversation_started"],
    NOT_QUALIFIED: ["conversation_started"],
    CALL_OFFERED: ["conversation_started", "offer_made"],
    CALL_BOOKED: ["conversation_started", "offer_made", "call_booked"],
    SHOWED: ["conversation_started", "offer_made", "call_booked", "showed"],
    WON: ["conversation_started", "offer_made", "call_booked", "showed", "won"],
    LOST: ["conversation_started"],
  };
  return mockThreads().flatMap((t, i) => {
    const c = t.contact;
    if (!c) return [];
    const s = mockCrmState(c.id);
    return [
      {
        id: c.id,
        // Spread over the last three weeks so 7/30/90 differ.
        createdAt: new Date(now.getTime() - (2 + i * 1.7) * DAY),
        kind: c.kind,
        kindSource: c.kindSource ?? null,
        entryPath: c.entryPath ?? null,
        spam: s.spam,
        spamOverride: s.spamOverride,
        archivedAt: s.archivedAt ? new Date(s.archivedAt) : null,
        stage: c.stage,
        setterStage: c.setterStage ?? null,
        attendance: c.id === "c8" ? "NO_SHOW" : null,
        columns,
        events: new Set(byStage[c.stage] ?? []),
        loggedColumns: new Set<string>(),
        wonAmount: c.stage === "WON" ? 1500 : null,
        wonAt: c.stage === "WON" ? new Date(now.getTime() - 3 * DAY) : null,
      } satisfies FunnelContact,
    ];
  });
}
