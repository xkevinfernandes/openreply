// The one-time imports (scripts/os-import-*.ts) write stage, J's stage hint
// and tags through the one stage writer and the one tag writer (cause import),
// after the contact row exists. Refused stage moves (an import never sets
// Booked/Showed/No-show, never takes someone off Won) are logged by the writer.
import type { ContactStage } from "@/app/generated/prisma/enums";
import { replaceContactTags } from "@/lib/os/fields/write";
import { writeStage, type StageWriteResult } from "@/lib/os/stage-writer";

export async function importWrites(
  workspaceId: string,
  contactId: string,
  w: { stage?: ContactStage | null; setterStage?: string | null; tags?: string[] | null }
): Promise<{ stage?: StageWriteResult; hint?: StageWriteResult; tags?: string[] }> {
  const out: { stage?: StageWriteResult; hint?: StageWriteResult; tags?: string[] } = {};
  if (w.stage) out.stage = await writeStage({ workspaceId, contactId, cause: "import", change: { type: "stage", stage: w.stage } }, { onStageChanged: null });
  if (w.setterStage) out.hint = await writeStage({ workspaceId, contactId, cause: "import", change: { type: "setterStage", setterStage: w.setterStage } }, { onStageChanged: null });
  // Imports never pushed to the CRMs on their own; they still don't.
  if (w.tags) out.tags = await replaceContactTags(workspaceId, contactId, w.tags, { sync: false });
  return out;
}
