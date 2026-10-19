// Setter hand-off per campaign: "Setter: Off" (automation only) or a setter
// that takes over once they reply. Stored in CampaignHandoff
// (prisma/os-automations.prisma); no row = Off. A CampaignSetter row (a named
// setter, also settable from Knowledge) counts as on.
//
// The rule J follows (queueSetterForInbound calls campaignHoldsSetter):
//   An inbound event that belongs to a Setter-Off campaign's own flow never
//   reaches J (no draft, no triage). The flow is exactly what OpenReply
//   answers by itself:
//     1. a tap on that campaign's button (payload reveal:/followcheck:<id>),
//     2. a DM that answers that campaign's open email prompt (the newest
//        AWAITING EmailCapture inside the gate window, as the worker picks it),
//     3. a DM that is that campaign's DM keyword (when every campaign the
//        text triggers is Off).
//   Anything else they write is outside the flow: J drafts as usual (still
//   Approve-only). OpenReply's sending is not touched either way.

import { prisma } from "@/lib/db/client";
import { EMAIL_GATE_WINDOW_MS } from "@/lib/email-gate";
import { matchKeywords } from "@/lib/utils/keyword-matcher";

export interface HandoffEvent {
  workspaceId: string;
  /** Our InstagramAccount.id. */
  instagramAccountId: string;
  igUserId: string;
  /** A button tap: the postback payload. */
  tapPayload?: string | null;
  /** A DM: its text. */
  text?: string | null;
}

/** The campaign a postback belongs to: "reveal:<id>[:open]" or "followcheck:<id>". */
export function tapAutomationId(payload: string | null | undefined): string | null {
  const m = /^(?:reveal|followcheck):([^:]+)/.exec(payload ?? "");
  return m ? m[1] : null;
}

export interface HoldInput {
  /** Set for a button tap. */
  tapAutomationId?: string | null;
  /** The campaign whose open email prompt this DM answers. */
  emailGateAutomationId?: string | null;
  /** Active DM-keyword campaigns this DM's text triggers. */
  keywordAutomationIds?: string[];
  isOn: (automationId: string) => boolean;
}

/** Pure: true when J must stay out of this event (it is a Setter-Off campaign's flow). */
export function holdsSetter(i: HoldInput): boolean {
  if (i.tapAutomationId) return !i.isOn(i.tapAutomationId);
  if (i.emailGateAutomationId) return !i.isOn(i.emailGateAutomationId);
  const kw = i.keywordAutomationIds ?? [];
  return kw.length > 0 && kw.every((id) => !i.isOn(id));
}

/** Which of these campaigns hand off to a setter. */
export async function setterOnSet(workspaceId: string, automationIds: string[]): Promise<Set<string>> {
  if (!automationIds.length) return new Set();
  const [handoffs, setters] = await Promise.all([
    prisma.campaignHandoff.findMany({ where: { workspaceId, automationId: { in: automationIds }, setterOn: true }, select: { automationId: true } }),
    prisma.campaignSetter.findMany({ where: { workspaceId, automationId: { in: automationIds } }, select: { automationId: true } }),
  ]);
  return new Set([...handoffs, ...setters].map((r) => r.automationId));
}

/** Never throws: on error J behaves as before (drafts). */
export async function campaignHoldsSetter(event: HandoffEvent): Promise<boolean> {
  try {
    const tapId = event.tapPayload != null ? tapAutomationId(event.tapPayload) : null;
    let gateId: string | null = null;
    let kwIds: string[] = [];
    if (!tapId) {
      if (event.tapPayload != null) return false;
      const capture = await prisma.emailCapture.findFirst({
        where: {
          userId: event.igUserId,
          instagramAccountId: event.instagramAccountId,
          status: "AWAITING",
          createdAt: { gt: new Date(Date.now() - EMAIL_GATE_WINDOW_MS) },
          automation: { isActive: true, requireEmail: true },
        },
        orderBy: { createdAt: "desc" },
        select: { automationId: true },
      });
      gateId = capture?.automationId ?? null;
      if (!gateId && event.text) {
        const autos = await prisma.automation.findMany({
          where: { workspaceId: event.workspaceId, instagramAccountId: event.instagramAccountId, dmTriggerEnabled: true, isActive: true },
          select: { id: true, keywords: true, matchAnyWord: true, wholeWordMatch: true },
        });
        kwIds = autos.filter((a) => a.matchAnyWord || matchKeywords(event.text ?? "", a.keywords, a.wholeWordMatch).matched).map((a) => a.id);
      }
    }
    const ids = [tapId, gateId, ...kwIds].filter((x): x is string => Boolean(x));
    if (!ids.length) return false;
    const on = await setterOnSet(event.workspaceId, ids);
    return holdsSetter({ tapAutomationId: tapId, emailGateAutomationId: gateId, keywordAutomationIds: kwIds, isOn: (id) => on.has(id) });
  } catch (err) {
    console.error("[OS Automations] hand-off check:", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Setter choice for one campaign: "off", "default" (account default) or a setter id. */
export type HandoffChoice = "off" | "default" | string;

export async function campaignHandoffChoice(workspaceId: string, automationId: string): Promise<HandoffChoice> {
  const [h, s] = await Promise.all([
    prisma.campaignHandoff.findUnique({ where: { automationId }, select: { setterOn: true, workspaceId: true } }),
    prisma.campaignSetter.findUnique({ where: { automationId }, select: { setterId: true, workspaceId: true } }),
  ]);
  if (s && s.workspaceId === workspaceId) return s.setterId;
  return h && h.workspaceId === workspaceId && h.setterOn ? "default" : "off";
}
