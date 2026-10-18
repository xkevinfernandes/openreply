// Hooks the rest of the app calls when something a CRM cares about happens.
import { prisma } from "@/lib/db/client";
import { upsertContact } from "@/lib/os/contacts";
import { fireContactEvent } from "./queue";

export { fireContactEvent };

/**
 * The email gate got an email (lib/queue/dm-worker.ts, EmailCapture →
 * CAPTURED). Stores it on the Contact and pushes the contact. Never throws.
 */
export async function recordCapturedEmail(input: {
  workspaceId: string;
  /** Our InstagramAccount.id. */
  instagramAccountId: string;
  igUserId: string;
  username: string | null;
  email: string;
}) {
  try {
    // Email gates only run on campaigns, so a first-seen person is a lead.
    const commented = await prisma.dmLog.findFirst({
      where: { instagramAccountId: input.instagramAccountId, commenterId: input.igUserId },
      select: { id: true },
    });
    const contact = await upsertContact({
      workspaceId: input.workspaceId,
      instagramAccountId: input.instagramAccountId,
      igUserId: input.igUserId,
      username: input.username,
      entryPath: commented ? "comment" : "keyword_dm",
    });
    await prisma.contact.update({ where: { id: contact.id }, data: { email: input.email.toLowerCase() } });
    await fireContactEvent({ workspaceId: input.workspaceId, contactId: contact.id, event: "email_captured" });
  } catch (error) {
    console.error("[OS Sync] could not record the captured email:", error instanceof Error ? error.message : error);
  }
}
