// The thread as the Inbox draws it (InboxA): time separators, runs of
// bubbles per side, the avatar on the last bubble of their run, and under our
// last bubble of a run the foot: "Seen", the lead magnet chip, the setter
// mark. Pure: the page builds the extras, the client re-runs this when older
// messages are prepended. Owner: S1.

import type { MediaView } from "@/lib/os/media";
import type { MessagePart, RichMessage } from "@/lib/os/messages/types";

/** A new centred timestamp after this much quiet. */
export const TIME_GAP_MS = 30 * 60_000;

export interface ThreadExtras {
  /** Who J is on this contact ("J", "Nova"). */
  setterName: string;
  /** Enrichment per message id (voice transcript, story card, caption). */
  media: Record<string, MediaView>;
  /** Outgoing message id → lead magnet name ("Script Vault" chip). */
  leadMagnetByMessage: Record<string, string>;
  /** Automation id → keyword ("SETTER") for opener marks. */
  openerByAutomation: Record<string, string>;
}

export interface ThreadFoot {
  seen: boolean;
  /** Setter name when a setter wrote a bubble in this run. */
  setter: string | null;
  leadMagnet: string | null;
}

export type ThreadRow =
  | { kind: "time"; key: string; label: string }
  | {
      kind: "message";
      key: string;
      message: RichMessage;
      side: "in" | "out";
      /** Incoming: show their avatar (last bubble of the run). */
      avatar: boolean;
      media: MediaView | null;
      /** Sent by an OpenReply automation: its keyword, else "Opener". */
      opener: string | null;
      /** Outgoing, last of its run, when there is something to say. */
      foot: ThreadFoot | null;
    };

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);

/** Oldest first, deduped by id (later copies win). */
export function mergeMessages(...lists: RichMessage[][]): RichMessage[] {
  const byId = new Map<string, RichMessage>();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (ms(a.at) || 0) - (ms(b.at) || 0));
}

function parts(tz: string, d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), day: get("day"), month: get("month"), year: get("year"), hour: String(Number(get("hour"))), minute: get("minute") };
}

/** "Today 9:41" or "Fri 17 Oct, 9:12" in the workspace timezone. */
export function timeLabel(iso: string, now: number, tz = "Europe/Luxembourg"): string {
  const d = new Date(iso);
  const p = parts(tz, d);
  const today = parts(tz, new Date(now));
  const time = `${p.hour}:${p.minute}`;
  if (p.day === today.day && p.month === today.month && p.year === today.year) return `Today ${time}`;
  const year = p.year !== today.year ? ` ${p.year}` : "";
  return `${p.weekday} ${p.day} ${p.month}${year}, ${time}`;
}

/** The words of a message, for matching against what a setter sent. */
export function plainText(m: Pick<RichMessage, "parts">): string {
  return m.parts
    .map((p) => (p.type === "text" ? p.text : p.type === "link" ? p.url : ""))
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Sent bubbles of approved drafts ("a\n\nb" edits split per bubble). */
export function sentBubbleSet(drafts: { bubbles: string[]; editedText?: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const d of drafts) {
    const bubbles = d.editedText ? d.editedText.split(/\n\s*\n/) : d.bubbles;
    for (const b of bubbles) {
      const t = b.toLowerCase().replace(/\s+/g, " ").trim();
      if (t) out.add(t);
    }
  }
  return out;
}

/** The J marker: outgoing API messages whose text a setter's draft sent.
 *  Zernio only says "api", so the match is on the words. */
export function markSetterMessages(messages: RichMessage[], sent: Set<string>): RichMessage[] {
  if (!sent.size) return messages;
  return messages.map((m) => {
    if (m.fromSetter || m.direction !== "outgoing" || m.origin === "automation") return m;
    const t = plainText(m);
    return t && sent.has(t) ? { ...m, fromSetter: true } : m;
  });
}

/** "kevinfernandes.me/script-vault" for any spelling of the same link. */
export function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/** Outgoing links that are one of our lead magnets → its name. */
export function leadMagnetsByMessage(messages: RichMessage[], resources: { name: string; link: string | null }[]): Record<string, string> {
  const byUrl = new Map(resources.filter((r) => r.link).map((r) => [normaliseUrl(r.link!), r.name]));
  const out: Record<string, string> = {};
  if (!byUrl.size) return out;
  for (const m of messages) {
    if (m.direction !== "outgoing") continue;
    const hit = m.parts.map((p) => (p.type === "link" ? byUrl.get(normaliseUrl(p.url)) : undefined)).find(Boolean);
    if (hit) out[m.id] = hit;
  }
  return out;
}

/** The rows the thread draws, oldest first. */
export function buildThreadRows(messages: RichMessage[], extras: ThreadExtras, now: number, tz?: string): ThreadRow[] {
  const sorted = mergeMessages(messages);
  const lastSeenOut = [...sorted].reverse().find((m) => m.direction === "outgoing" && !m.deleted);
  const seenId = lastSeenOut?.seenAt ? lastSeenOut.id : null;

  // Split into runs: same side, no time separator in between.
  const rows: ThreadRow[] = [];
  let run: RichMessage[] = [];
  let prevAt = NaN;

  const flush = () => {
    if (!run.length) return;
    const side = run[0].direction === "incoming" ? "in" : "out";
    const setter = run.some((m) => m.fromSetter) ? extras.setterName : null;
    const leadMagnet = run.map((m) => extras.leadMagnetByMessage[m.id]).find(Boolean) ?? null;
    run.forEach((m, i) => {
      const last = i === run.length - 1;
      const seen = side === "out" && last && run.some((x) => x.id === seenId);
      const foot = side === "out" && last && (seen || setter || leadMagnet) ? { seen, setter, leadMagnet } : null;
      rows.push({
        kind: "message",
        key: m.id,
        message: m,
        side,
        avatar: side === "in" && last,
        media: extras.media[m.id] ?? null,
        opener: m.origin === "automation" ? (m.automationId ? extras.openerByAutomation[m.automationId] : null) ?? "Opener" : null,
        foot,
      });
    });
    run = [];
  };

  for (const m of sorted) {
    const at = ms(m.at);
    const gap = !rows.length && !run.length ? true : Number.isFinite(at) && Number.isFinite(prevAt) && at - prevAt > TIME_GAP_MS;
    if (gap) {
      flush();
      if (m.at) rows.push({ kind: "time", key: `t-${m.id}`, label: timeLabel(m.at, now, tz) });
    } else if (run.length && run[0].direction !== m.direction) {
      flush();
    }
    run.push(m);
    if (Number.isFinite(at)) prevAt = at;
  }
  flush();
  return rows;
}

/** 25 bar heights (6-22px), stable per message. */
export function waveform(seed: string, bars = 25): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    out.push(6 + (Math.abs(h) % 9) * 2);
  }
  return out;
}

/** 14000 → "0:14". */
export function formatDuration(msLen: number | null | undefined): string {
  if (!msLen || msLen < 0) return "";
  const s = Math.round(msLen / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Hours left in Meta's 24h window after their last message; null if none. */
export function windowHoursLeft(messages: RichMessage[], now: number): number | null {
  const last = [...messages].reverse().find((m) => m.direction === "incoming" && m.at);
  if (!last) return null;
  return Math.max(0, Math.ceil((ms(last.at) + 24 * 3600_000 - now) / 3600_000));
}

/** The text J reads for a part (shown as the aria label too). */
export function partAria(p: MessagePart, media: MediaView | null): string {
  switch (p.type) {
    case "voice":
      return `Voice note${media?.durationMs || p.durationMs ? `, ${Math.round((media?.durationMs ?? p.durationMs ?? 0) / 1000)} seconds` : ""}`;
    case "share":
      return `Shared ${p.kind}`;
    case "story_reply":
      return p.mention ? "Mentioned you in their story" : "Replied to your story";
    default:
      return "";
  }
}
