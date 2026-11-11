"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { normalizeCalendarSettings, type CalendarSettings } from "@/lib/os/integrations/calendar/settings";
import { filterSlots, formatSlotShort, pickOptions } from "@/lib/os/integrations/calendar/slots";
import { calendarClient, encryptCalendarToken, loadCalendarProvider } from "@/lib/os/integrations/calendar/store";
import { CalendarApiError, type CalendarEventType, type CalendarProviderId } from "@/lib/os/integrations/calendar/types";
import { setupCalendarWebhook, unregisterCalendarWebhook } from "@/lib/os/sequences/calendar-sync";
import { recordConnect, recordDisconnect } from "@/lib/os/conn/audit";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export interface CalendarActionResult {
  error?: string;
  notice?: string;
}

const providerSchema = z.enum(["calcom", "calendly"]);
const NAMES: Record<CalendarProviderId, string> = { calcom: "Cal.com", calendly: "Calendly" };

async function requireManagerContext() {
  const context = await getCurrentWorkspaceContext();
  if (!context) throw new Error("Sign in again.");
  if (!canManageWorkspace(context.role)) throw new Error("Only workspace owners and admins can manage integrations.");
  return context;
}

async function requireManager() {
  return (await requireManagerContext()).workspaceId;
}

function friendly(error: unknown): string {
  if (error instanceof CalendarApiError) return error.message;
  return error instanceof Error ? error.message.slice(0, 200) : "Something went wrong.";
}

async function run(fn: () => Promise<CalendarActionResult>): Promise<CalendarActionResult> {
  try {
    const r = await fn();
    revalidatePath("/os/settings");
    return r;
  } catch (error) {
    return { error: friendly(error) };
  }
}

const json = (s: CalendarSettings) => JSON.parse(JSON.stringify(s));

/** Test the key, save it encrypted, and make this the calendar J books on
 *  (one at a time: the other one is switched off). */
export async function connectCalendar(provider: CalendarProviderId, token: string): Promise<CalendarActionResult> {
  return run(async () => {
    const { workspaceId, userId } = await requireManagerContext();
    const p = providerSchema.parse(provider);
    const clean = z.string().trim().min(10, "Paste the whole key.").max(4096).safeParse(token);
    if (!clean.success) return { error: clean.error.issues[0]?.message ?? "Paste the key." };
    const client = calendarClient(p, clean.data);
    const account = await client.verify();
    const types = await client.listEventTypes().catch(() => [] as CalendarEventType[]);
    const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: p } } });
    const settings = normalizeCalendarSettings(row?.settings);
    if (account.timezone && settings.hostTimezone === "UTC") settings.hostTimezone = account.timezone;
    settings.accountName = account.name ?? account.email ?? settings.accountName;
    // One event type? Use it for every setter until Kevin picks.
    if (!settings.eventTypes.default && types.length === 1) {
      settings.eventTypes.default = types[0].id;
      settings.eventTypeInfo[types[0].id] = { name: types[0].name, durationMinutes: types[0].durationMinutes };
    }
    settings.directBooking = true;
    const data = { credentials: encryptCalendarToken(clean.data), enabled: true, lastTestedAt: new Date(), lastError: null, settings: json(settings) };
    await prisma.$transaction([
      prisma.osIntegration.upsert({ where: { workspaceId_provider: { workspaceId, provider: p } }, create: { workspaceId, provider: p, ...data }, update: data }),
      prisma.osIntegration.updateMany({ where: { workspaceId, provider: { in: ["calcom", "calendly"], not: p } }, data: { enabled: false } }),
    ]);
    await recordConnect(workspaceId, p, { actorId: userId, account: account.name ?? account.email ?? null });
    return { notice: `${NAMES[p]} connected${account.name ? ` as ${account.name}` : ""}. J books on it now.` };
  });
}

export async function disconnectCalendar(provider: CalendarProviderId): Promise<CalendarActionResult> {
  return run(async () => {
    const { workspaceId, userId } = await requireManagerContext();
    const p = providerSchema.parse(provider);
    // Delete the webhook we registered at the provider first, while we still
    // hold the token (it used to be left behind). A refusal doesn't block the
    // disconnect: it is said, and logged as revoke_failed.
    const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: p } }, select: { credentials: true } });
    let revokeError: string | null = null;
    try {
      await unregisterCalendarWebhook(workspaceId, p, row?.credentials ?? null);
    } catch (error) {
      revokeError = friendly(error);
    }
    // Keep the settings, drop the secret: J goes back to sending the booking link.
    await prisma.osIntegration.updateMany({
      where: { workspaceId, provider: p },
      data: { credentials: null, enabled: false, lastError: null, ...(revokeError ? {} : { webhookSecret: null }) },
    });
    await recordDisconnect(workspaceId, p, { actorId: userId, revokeError, note: revokeError ? null : "Webhook deleted" });
    if (revokeError) {
      return {
        notice: `${NAMES[p]} disconnected. J sends your booking link again. ${NAMES[p]} didn't let us delete our webhook (${revokeError}); remove it in ${NAMES[p]}'s webhook settings.`,
      };
    }
    return { notice: `${NAMES[p]} disconnected. J sends your booking link again.` };
  });
}

export async function testCalendar(provider: CalendarProviderId): Promise<CalendarActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    const loaded = await loadCalendarProvider(workspaceId, p);
    if (!loaded) return { error: "Connect it first." };
    let lastError: string | null = null;
    try {
      await loaded.client.verify();
    } catch (error) {
      lastError = friendly(error);
    }
    await prisma.osIntegration.updateMany({ where: { workspaceId, provider: p }, data: { lastTestedAt: new Date(), lastError } });
    return lastError ? { error: lastError } : { notice: "Connection works." };
  });
}

/** Switch J's booking on this calendar on or off (on switches the other off). */
export async function setCalendarEnabled(provider: CalendarProviderId, enabled: boolean): Promise<CalendarActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    if (enabled) {
      await prisma.$transaction([
        prisma.osIntegration.updateMany({ where: { workspaceId, provider: p, credentials: { not: null } }, data: { enabled: true } }),
        prisma.osIntegration.updateMany({ where: { workspaceId, provider: { in: ["calcom", "calendly"], not: p } }, data: { enabled: false } }),
      ]);
      return { notice: `J books on ${NAMES[p]}.` };
    }
    await prisma.osIntegration.updateMany({ where: { workspaceId, provider: p }, data: { enabled: false } });
    return { notice: "J sends your booking link instead." };
  });
}

export async function loadEventTypes(provider: CalendarProviderId): Promise<{ types?: CalendarEventType[]; error?: string }> {
  try {
    const workspaceId = await requireManager();
    const loaded = await loadCalendarProvider(workspaceId, providerSchema.parse(provider));
    if (!loaded) return { error: "Connect it first." };
    return { types: await loaded.client.listEventTypes() };
  } catch (error) {
    return { error: friendly(error) };
  }
}

const settingsSchema = z.object({
  eventTypes: z.record(z.string().max(64), z.string().max(300)).optional(),
  eventTypeInfo: z.record(z.string().max(300), z.object({ name: z.string().max(120), durationMinutes: z.number().nullable() })).optional(),
  hostTimezone: z.string().max(64).optional(),
  workStart: z.number().int().optional(),
  workEnd: z.number().int().optional(),
  workDays: z.array(z.number().int()).optional(),
  minNoticeHours: z.number().int().optional(),
  daysAhead: z.number().int().optional(),
  options: z.number().int().optional(),
});

export async function saveCalendarSettings(provider: CalendarProviderId, patch: unknown): Promise<CalendarActionResult> {
  return run(async () => {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    const parsed = settingsSchema.safeParse(patch);
    if (!parsed.success) return { error: "Check the settings." };
    const row = await prisma.osIntegration.findUnique({ where: { workspaceId_provider: { workspaceId, provider: p } } });
    if (!row) return { error: "Connect it first." };
    const current = normalizeCalendarSettings(row.settings);
    const next = normalizeCalendarSettings({ ...current, ...parsed.data, directBooking: current.directBooking, accountName: current.accountName });
    // Drop names of event types no setter uses any more.
    const used = new Set(Object.values(next.eventTypes));
    next.eventTypeInfo = Object.fromEntries(Object.entries(next.eventTypeInfo).filter(([id]) => used.has(id)));
    await prisma.osIntegration.update({ where: { id: row.id }, data: { settings: json(next) } });
    return { notice: "Saved. J uses it from the next draft." };
  });
}

/** "Which times would J offer?": the next free times with these settings. */
export async function previewTimes(provider: CalendarProviderId): Promise<{ times?: string[]; offered?: string[]; error?: string }> {
  try {
    const workspaceId = await requireManager();
    const loaded = await loadCalendarProvider(workspaceId, providerSchema.parse(provider));
    if (!loaded) return { error: "Connect it first." };
    const s = loaded.settings;
    const eventTypeId = s.eventTypes.default ?? Object.values(s.eventTypes)[0];
    if (!eventTypeId) return { error: "Pick an event type first." };
    const now = new Date();
    const raw = await loaded.client.getAvailableSlots(
      eventTypeId,
      { start: new Date(now.getTime() + s.minNoticeHours * 3600_000), end: new Date(now.getTime() + s.daysAhead * 86_400_000) },
      s.hostTimezone
    );
    const slots = filterSlots(raw, s, now, s.eventTypeInfo[eventTypeId]?.durationMinutes ?? null);
    if (!slots.length) return { times: [], offered: [] };
    return {
      times: slots.slice(0, 8).map((x) => formatSlotShort(x.start, s.hostTimezone)),
      offered: pickOptions(slots, s.options, null).map((x) => formatSlotShort(x.start, s.hostTimezone)),
    };
  } catch (error) {
    return { error: friendly(error) };
  }
}

export interface WebhookActionResult extends CalendarActionResult {
  webhook?: { url: string; secret: string; registered: boolean };
}

/** Cancels, reschedules and no-shows: make the signing secret and register
 *  our webhook with the calendar (or say how to add it by hand). */
export async function setupCalendarWebhooks(provider: CalendarProviderId): Promise<WebhookActionResult> {
  try {
    const workspaceId = await requireManager();
    const p = providerSchema.parse(provider);
    const r = await setupCalendarWebhook(workspaceId, p);
    revalidatePath("/os/settings");
    // The signing secret leaves the server only when it has to be pasted by hand.
    return { ...(r.registered ? { notice: r.message } : { error: r.message }), webhook: { url: r.url, secret: r.registered ? "" : r.secret, registered: r.registered } };
  } catch (error) {
    return { error: friendly(error) };
  }
}
