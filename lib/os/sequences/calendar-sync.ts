// Applies one calendar webhook event (calendar-events.ts) to our bookings,
// then re-plans that person's follow-ups: a reschedule moves the reminders,
// a cancel stops them, a no-show starts the human re-engagement.
//
// Matching, strongest first: the provider's id (Booking.externalId); for a
// Calendly link J sent, the LINK_SENT booking with the same email; else a
// contact with that email (they booked from a link we didn't track).

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { fireContactEvent } from "@/lib/os/integrations/queue";
import { calFetch } from "@/lib/os/integrations/calendar/http";
import { CalendarApiError, type CalendarProviderId } from "@/lib/os/integrations/calendar/types";
import { iso, logEvent, type SetterRecord } from "@/lib/os/setter/state";
import { setterStore } from "@/lib/os/setter/store";
import { CALCOM_TRIGGERS, CALENDLY_EVENTS, type CalendarEvent } from "@/lib/os/sequences/calendar-events";
import { markAttendance, syncFollowupsQuietly } from "@/lib/os/sequences/engine";

export interface ApplyResult {
  status: "ignored" | "unmatched" | "created" | "updated" | "cancelled" | "attendance";
  bookingId?: string;
}

const LATE_STAGES = ["CALL_BOOKED", "SHOWED", "WON", "LOST"];

async function findBooking(workspaceId: string, provider: string, ids: (string | null | undefined)[]) {
  const list = ids.filter((x): x is string => Boolean(x));
  if (!list.length) return null;
  return prisma.booking.findFirst({ where: { workspaceId, provider, externalId: { in: list } }, orderBy: { createdAt: "desc" } });
}

/** J's record follows the calendar, so it never says "booked for Tuesday" after a move. */
async function updateRecord(workspaceId: string, contactId: string, edit: (rec: SetterRecord) => void) {
  const store = setterStore();
  const contact = await store.getContact(contactId, workspaceId);
  const rec = contact ? await store.loadState(contactId) : null;
  if (!contact || !rec) return;
  edit(rec);
  await store.saveState(contact, rec);
}

export async function applyCalendarEvent(workspaceId: string, provider: CalendarProviderId, ev: CalendarEvent, now = new Date()): Promise<ApplyResult> {
  if (ev.kind === "ignored") return { status: "ignored" };

  if (ev.kind === "no_show" || ev.kind === "no_show_cleared") {
    const b = await findBooking(workspaceId, provider, [ev.externalId]);
    if (!b) return { status: "unmatched" };
    if (ev.kind === "no_show_cleared" && b.attendance !== "NO_SHOW") return { status: "ignored", bookingId: b.id };
    await markAttendance(workspaceId, b.contactId, ev.kind === "no_show" ? "NO_SHOW" : null, provider, { bookingId: b.id, now });
    return { status: "attendance", bookingId: b.id };
  }

  if (ev.kind === "cancelled") {
    const b = await findBooking(workspaceId, provider, [ev.externalId]);
    if (!b) return { status: "unmatched" };
    if (b.status !== "CANCELLED") {
      await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelledAt: now } });
      await updateRecord(workspaceId, b.contactId, (rec) => {
        rec.booking = null;
        logEvent(rec, now, `booking:cancelled:${provider}`);
      });
    }
    await syncFollowupsQuietly(b.contactId, { workspaceId });
    return { status: "cancelled", bookingId: b.id };
  }

  // created / rescheduled
  if (!ev.start) return { status: "ignored" };
  const start = new Date(ev.start);
  const end = ev.end ? new Date(ev.end) : null;
  let b = await findBooking(workspaceId, provider, [ev.previousExternalId, ev.externalId]);
  if (!b && ev.email) {
    b = await prisma.booking.findFirst({
      where: { workspaceId, provider, status: "LINK_SENT", email: { equals: ev.email, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
    });
  }
  if (b) {
    const moved = b.start.getTime() !== start.getTime();
    await prisma.booking.update({
      where: { id: b.id },
      data: {
        externalId: ev.externalId ?? b.externalId,
        start,
        end,
        ...(b.status === "LINK_SENT" || b.status === "CANCELLED" ? { status: "BOOKED", cancelledAt: null } : {}),
        ...(moved && b.status !== "LINK_SENT" ? { rescheduledAt: now, attendance: null, attendanceAt: null, attendanceSource: null } : {}),
        ...(ev.timezone && b.status === "LINK_SENT" ? { timezone: ev.timezone } : {}),
      },
    });
    await updateRecord(workspaceId, b.contactId, (rec) => {
      if (rec.booking) rec.booking = { ...rec.booking, phase: rec.booking.phase === "link_sent" ? "booked" : rec.booking.phase, start: iso(start), booking_id: b!.id };
      logEvent(rec, now, `booking:${moved ? "moved" : "seen"}:${provider}`);
    });
    await syncFollowupsQuietly(b.contactId, { workspaceId });
    return { status: "updated", bookingId: b.id };
  }

  // Someone we know booked straight from a link.
  if (!ev.email) return { status: "unmatched" };
  const contact = await prisma.contact.findFirst({ where: { workspaceId, email: { equals: ev.email, mode: "insensitive" } }, orderBy: { lastMessageAt: "desc" } });
  if (!contact) return { status: "unmatched" };
  const created = await prisma.booking.create({
    data: {
      workspaceId,
      contactId: contact.id,
      provider,
      eventTypeId: "webhook",
      externalId: ev.externalId,
      start,
      end,
      timezone: ev.timezone ?? "UTC",
      name: ev.name,
      email: ev.email,
      status: "BOOKED",
    },
  });
  if (!LATE_STAGES.includes(contact.stage)) {
    await prisma.contact.update({ where: { id: contact.id }, data: { stage: "CALL_BOOKED" } });
    await fireContactEvent({ workspaceId, contactId: contact.id, event: "stage_changed" });
  }
  await syncFollowupsQuietly(contact.id, { workspaceId });
  return { status: "created", bookingId: created.id };
}

// ---------------------------------------------------------------- setup
export function webhookUrl(workspaceId: string, provider: CalendarProviderId): string {
  return `${getBaseUrl().replace(/\/+$/, "")}/api/os/calendar/${provider}/${workspaceId}`;
}

/** The workspace's signing secret for one calendar, made on first use. */
export async function webhookSecret(workspaceId: string, provider: CalendarProviderId, opts: { create?: boolean } = {}): Promise<string | null> {
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } }, select: { webhookSecret: true } });
  if (row?.webhookSecret) {
    try {
      return decryptToken(row.webhookSecret);
    } catch {
      // Unreadable (key rotated): make a new one below.
    }
  }
  if (!opts.create || !row) return null;
  const secret = randomBytes(24).toString("hex");
  await prisma.osIntegration.update({ where: { workspaceId_provider: { workspaceId, provider } }, data: { webhookSecret: encryptToken(secret) } });
  return secret;
}

export interface WebhookSetup {
  url: string;
  secret: string;
  /** True when we registered it with the provider's API ourselves. */
  registered: boolean;
  message: string;
}

function tokenFor(credentials: string | null): string | null {
  if (!credentials) return null;
  try {
    return (JSON.parse(decryptToken(credentials)) as { token?: string }).token ?? null;
  } catch {
    return null;
  }
}

/** Register (or re-register) our webhook with the provider. Idempotent: an
 *  old subscription to the same URL is removed first, so the secret matches. */
async function registerWithApi(provider: CalendarProviderId, token: string, url: string, secret: string): Promise<void> {
  const auth = { Authorization: `Bearer ${token}` };
  if (provider === "calendly") {
    const base = "https://api.calendly.com";
    const me = await calFetch<{ resource?: { uri?: string; current_organization?: string } }>("calendly", `${base}/users/me`, { headers: auth });
    const user = me.resource?.uri;
    const organization = me.resource?.current_organization;
    if (!user || !organization) throw new Error("Calendly didn't say which account this key belongs to.");
    const q = new URLSearchParams({ organization, user, scope: "user" });
    const list = await calFetch<{ collection?: { uri?: string; callback_url?: string }[] }>("calendly", `${base}/webhook_subscriptions?${q}`, { headers: auth });
    for (const sub of list.collection ?? []) if (sub.callback_url === url && sub.uri) await calFetch("calendly", sub.uri, { method: "DELETE", headers: auth });
    await calFetch("calendly", `${base}/webhook_subscriptions`, {
      method: "POST",
      headers: auth,
      body: { url, events: CALENDLY_EVENTS, organization, user, scope: "user", signing_key: secret },
    });
    return;
  }
  const base = "https://api.cal.com/v2";
  const list = await calFetch<{ data?: { id?: number | string; subscriberUrl?: string }[] }>("calcom", `${base}/webhooks`, { headers: auth });
  for (const w of Array.isArray(list.data) ? list.data : []) if (w.subscriberUrl === url && w.id != null) await calFetch("calcom", `${base}/webhooks/${w.id}`, { method: "DELETE", headers: auth });
  await calFetch("calcom", `${base}/webhooks`, { method: "POST", headers: auth, body: { active: true, subscriberUrl: url, triggers: CALCOM_TRIGGERS, secret } });
}

/** "Set up webhooks" on the calendar card: the secret, the URL, and an
 *  attempt to register it for you. Manual steps when the API says no. */
export async function setupCalendarWebhook(workspaceId: string, provider: CalendarProviderId): Promise<WebhookSetup> {
  const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } });
  if (!row) throw new Error("Connect the calendar first.");
  const secret = (await webhookSecret(workspaceId, provider, { create: true }))!;
  const url = webhookUrl(workspaceId, provider);
  const token = tokenFor(row.credentials);
  const local = /localhost|127\.0\.0\.1|\.local\b/.test(url);
  if (!token || local) {
    return {
      url,
      secret,
      registered: false,
      message: local ? "This server isn't reachable from the internet (localhost), so nothing was registered. On the live app, press this again." : "Reconnect the calendar key, then try again.",
    };
  }
  try {
    await registerWithApi(provider, token, url, secret);
    return { url, secret, registered: true, message: provider === "calendly" ? "Calendly will tell J about cancels, reschedules and no-shows." : "Cal.com will tell J about cancels, reschedules and no-shows." };
  } catch (err) {
    const plan = err instanceof CalendarApiError && (err.code === "plan" || err.status === 403);
    return {
      url,
      secret,
      registered: false,
      message:
        provider === "calendly"
          ? plan
            ? "Calendly only sends webhooks on paid plans (Standard and up). Until then, mark Showed / No-show yourself."
            : `Calendly refused the webhook (${err instanceof Error ? err.message : "unknown error"}).`
          : `Cal.com refused it (${err instanceof Error ? err.message : "unknown error"}). Add it by hand: Cal.com → Settings → Developer → Webhooks → New, paste the URL and secret below, tick Booking cancelled, rescheduled, created and no-show updated.`,
    };
  }
}
