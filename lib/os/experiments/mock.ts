// OS_MOCK sample experiments. The numbers are MADE UP (shaped like SetDM's
// table in the research doc) so the screen has something to show; the UI
// marks them "Sample".

import type { FunnelCounts } from "@/lib/os/experiments/funnel";
import type { ExperimentFull } from "@/lib/os/experiments/store";

export type MockExperiment = Omit<ExperimentFull, "sample"> & { sampleCounts: Record<string, FunnelCounts> | null };

const days = (d: number) => new Date(Date.now() - d * 86400_000);

const c = (sent: number, replied: number, valueSent: number, inviteSent: number, booked: number, showed: number, edited = 0): FunnelCounts => ({
  assigned: sent,
  sent,
  edited,
  replied,
  valueSent,
  inviteSent,
  booked,
  showed,
});

export function mockSeed(workspaceId: string): MockExperiment[] {
  return [
    {
      id: "sample-exp-opener",
      workspaceId,
      setterId: null,
      name: "Claude Code reel: opening DM",
      slot: "campaign_opener:sample-automation-1",
      status: "RUNNING",
      allocation: "EVEN",
      minSends: 50,
      winnerVariantId: null,
      startedAt: days(12),
      finishedAt: null,
      variants: [
        { id: "sample-v-a", label: "A", text: "hey, appreciate you commenting! want the guide?", weight: 1, active: true, style: "generic_thanks" },
        { id: "sample-v-b", label: "B", text: "saw you commented CLAUDE, what are you hoping to build with it?", weight: 1, active: true, style: "references_action" },
        { id: "sample-v-c", label: "C", text: "ok you're the 40th person today lol, what's everyone building?", weight: 1, active: true, style: "pattern_interrupt" },
      ],
      sampleCounts: {
        "sample-v-a": c(412, 107, 98, 9, 3, 2),
        "sample-v-b": c(398, 191, 171, 31, 17, 13),
        "sample-v-c": c(405, 158, 140, 18, 7, 5),
      },
    },
    {
      id: "sample-exp-jopener",
      workspaceId,
      setterId: null,
      name: "J's first line after the resource",
      slot: "j_opener:post_keyword",
      status: "RUNNING",
      allocation: "EVEN",
      minSends: 50,
      winnerVariantId: null,
      startedAt: days(6),
      finishedAt: null,
      variants: [
        { id: "sample-v-ja", label: "A", text: "did the guide make sense?", weight: 1, active: true, style: "custom" },
        { id: "sample-v-jb", label: "B", text: "what's the main thing you're building with claude right now?", weight: 1, active: true, style: "specific_question" },
      ],
      sampleCounts: {
        "sample-v-ja": c(31, 9, 2, 1, 0, 0, 2),
        "sample-v-jb": c(28, 15, 4, 3, 2, 1, 1),
      },
    },
    {
      id: "sample-exp-invite",
      workspaceId,
      setterId: null,
      name: "Invite wording",
      slot: "line:invite",
      status: "PAUSED",
      allocation: "WEIGHTED",
      minSends: 30,
      winnerVariantId: null,
      startedAt: days(20),
      finishedAt: null,
      variants: [
        { id: "sample-v-ia", label: "A", text: "want to hop on a quick call this week?", weight: 1, active: true, style: "custom" },
        { id: "sample-v-ib", label: "B", text: "easier to show you than spam you in dms. want me to share my screen for 15 min this week?", weight: 2, active: true, style: "screen_share" },
      ],
      sampleCounts: {
        "sample-v-ia": c(22, 14, 0, 22, 6, 4, 3),
        "sample-v-ib": c(41, 30, 0, 41, 19, 15, 4),
      },
    },
  ];
}
