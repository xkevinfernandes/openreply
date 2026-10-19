// Cal.com and Calendly webhooks, the pure half: signature checks and turning
// each provider's payload into one CalendarEvent. No IO (calendar-sync.ts
// applies them), so both are tested on recorded shapes.
//
// Cal.com (Settings → Developer → Webhooks, or POST /v2/webhooks):
//   header X-Cal-Signature-256 = hex HMAC-SHA256(secret, raw body)
//   BOOKING_CREATED · BOOKING_RESCHEDULED · BOOKING_CANCELLED ·
//   BOOKING_NO_SHOW_UPDATED · AFTER_GUESTS_CAL_VIDEO_NO_SHOW · PING
// Calendly (API only: POST /webhook_subscriptions, Standard plan and up):
//   header Calendly-Webhook-Signature = "t=<unix>,v1=<hex HMAC-SHA256(key, `${t}.${body}`)>"
//   invitee.created · invitee.canceled · invitee_no_show.created · invitee_no_show.deleted

import { createHmac, timingSafeEqual } from "node:crypto";

export type CalendarEventKind = "created" | "rescheduled" | "cancelled" | "no_show" | "no_show_cleared" | "ignored";

export interface CalendarEvent {
  kind: CalendarEventKind;
  /** Cal.com booking uid / Calendly invitee uri: Booking.externalId. */
  externalId: string | null;
  /** A reschedule: the booking it replaces. */
  previousExternalId?: string | null;
  start?: string | null;
  end?: string | null;
  email?: string | null;
  name?: string | null;
  timezone?: string | null;
  /** What the provider called it, for the logs. */
  trigger: string;
}

/** Calendly's signatures older than this are refused (replays). */
export const CALENDLY_TOLERANCE_SECONDS = 5 * 60;

function hexEqual(a: string, expected: Buffer): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || a.length !== expected.length * 2) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), expected);
}

export function verifyCalcomSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  return hexEqual(header.trim(), createHmac("sha256", secret).update(rawBody).digest());
}

export function verifyCalendlySignature(rawBody: string, header: string | null, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(nowMs / 1000 - t) > CALENDLY_TOLERANCE_SECONDS) return false;
  return hexEqual(parts.v1, createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest());
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoOf = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/\.\d{3}Z$/, "Z");
};

export function parseCalcomEvent(body: unknown): CalendarEvent {
  const b = obj(body);
  const trigger = str(b.triggerEvent) ?? "unknown";
  const p = obj(b.payload);
  const attendees = Array.isArray(p.attendees) ? p.attendees.map(obj) : [];
  const guest = attendees[0] ?? {};
  const base = {
    trigger,
    externalId: str(p.uid) ?? str(p.bookingUid),
    start: isoOf(p.startTime),
    end: isoOf(p.endTime),
    email: str(guest.email)?.toLowerCase() ?? null,
    name: str(guest.name),
    timezone: str(guest.timeZone),
  };
  switch (trigger) {
    case "BOOKING_CREATED":
      return { ...base, kind: "created" };
    case "BOOKING_RESCHEDULED":
      return { ...base, kind: "rescheduled", previousExternalId: str(p.rescheduleUid) ?? str(p.fromReschedule) ?? str(p.originalRescheduledBooking && obj(p.originalRescheduledBooking).uid) };
    case "BOOKING_CANCELLED":
      return { ...base, kind: "cancelled" };
    case "BOOKING_NO_SHOW_UPDATED": {
      // The host marks attendees: noShow true / false per attendee.
      const marked = attendees.find((a) => typeof a.noShow === "boolean");
      return { ...base, externalId: str(p.bookingUid) ?? base.externalId, kind: marked?.noShow === false ? "no_show_cleared" : "no_show" };
    }
    case "AFTER_GUESTS_CAL_VIDEO_NO_SHOW":
      return { ...base, externalId: str(p.bookingUid) ?? base.externalId, kind: "no_show" };
    default:
      return { ...base, kind: "ignored" };
  }
}

export function parseCalendlyEvent(body: unknown): CalendarEvent {
  const b = obj(body);
  const trigger = str(b.event) ?? "unknown";
  const p = obj(b.payload);
  const ev = obj(p.scheduled_event);
  const invitee = {
    trigger,
    externalId: str(p.uri),
    start: isoOf(ev.start_time),
    end: isoOf(ev.end_time),
    email: str(p.email)?.toLowerCase() ?? null,
    name: str(p.name),
    timezone: str(p.timezone),
  };
  switch (trigger) {
    case "invitee.created":
      return str(p.old_invitee) ? { ...invitee, kind: "rescheduled", previousExternalId: str(p.old_invitee) } : { ...invitee, kind: "created" };
    case "invitee.canceled":
      // A reschedule cancels the old invitee, then creates the new one (with
      // old_invitee): the create carries the move, this half is ignored.
      return p.rescheduled === true ? { ...invitee, kind: "ignored" } : { ...invitee, kind: "cancelled" };
    case "invitee_no_show.created":
      return { trigger, kind: "no_show", externalId: str(p.invitee) ?? str(obj(p.invitee).uri) };
    case "invitee_no_show.deleted":
      return { trigger, kind: "no_show_cleared", externalId: str(p.invitee) ?? str(obj(p.invitee).uri) };
    default:
      return { ...invitee, kind: "ignored" };
  }
}

export const CALCOM_TRIGGERS = ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED", "BOOKING_NO_SHOW_UPDATED", "AFTER_GUESTS_CAL_VIDEO_NO_SHOW"];
export const CALENDLY_EVENTS = ["invitee.created", "invitee.canceled", "invitee_no_show.created", "invitee_no_show.deleted"];
