"use server";

// Knowledge bases › Setup: the funnel's per-stage Autopilot switch and the
// Booking page's read-only "show me the times" test. Scoped to the signed-in
// workspace; the funnel goes back through asFunnel like every other write.

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/app/generated/prisma/client";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { activeCalendar } from "@/lib/os/integrations/calendar/store";
import { formatSlot, tzCity } from "@/lib/os/integrations/calendar/slots";
import { loadBookingContext } from "@/lib/os/setter/booking";
import { asFunnel } from "@/lib/os/setter/kb";
import type { StageAutopilot } from "@/lib/os/setter/profile";
import { newRecord } from "@/lib/os/setter/state";

async function ownSetter(setterId: string) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  const s = await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { id: true, funnel: true } });
  if (!s) throw new Error("That knowledge base is gone. Refresh the page.");
  return { workspaceId, setter: s };
}

/** Approve ↔ Auto for one funnel stage. Saves at once. */
export async function setStageAutopilot(setterId: string, stageKey: string, mode: StageAutopilot): Promise<{ error?: string }> {
  try {
    const { setter } = await ownSetter(setterId);
    const funnel = asFunnel(setter.funnel);
    const stage = funnel.find((s) => s.key === stageKey);
    if (!stage) throw new Error("That stage isn't saved yet. Save the funnel first.");
    if (mode === "auto") stage.autopilot = "auto";
    else delete stage.autopilot;
    await prisma.setter.update({ where: { id: setter.id }, data: { funnel: asFunnel(funnel) as unknown as Prisma.InputJsonValue } });
    revalidatePath("/os/knowledge", "layout");
    return {};
  } catch (err) {
    console.error("[OS Knowledge] autopilot:", err);
    return { error: err instanceof Error ? err.message : "That didn't save. Try again." };
  }
}

export interface TestTimes {
  error?: string;
  /** The times J would offer right now, in the host's timezone. */
  times?: string[];
  timezone?: string;
}

/** The times J would offer a new lead right now. Reads the calendar; sends nothing. */
export async function testBookingTimes(setterId: string): Promise<TestTimes> {
  try {
    const { workspaceId, setter } = await ownSetter(setterId);
    const cal = await activeCalendar(workspaceId, setter.id);
    if (!cal) return { error: "No calendar for this setter (link mode, or nothing connected)." };
    if (!cal.eventTypeId) return { error: "Pick an event type in Integrations first." };
    const ctx = await loadBookingContext(cal, newRecord("test"), [], new Date());
    if (!ctx) return { error: "Pick an event type in Integrations first." };
    const tz = cal.settings.hostTimezone;
    if (!ctx.options.length) return { times: [], timezone: tzCity(tz) };
    return { times: ctx.options.map((s) => formatSlot(s.start, tz)), timezone: tzCity(tz) };
  } catch (err) {
    console.error("[OS Knowledge] test times:", err);
    return { error: err instanceof Error ? err.message : "Couldn't read the calendar." };
  }
}
