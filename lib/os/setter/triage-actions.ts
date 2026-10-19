"use server";
// "Re-sort pitches" as a server action. S1/S3 wire it to a button (Inbox
// Pitches tab or Settings › Diagnostics). Same as scripts/os-resort-pitches.ts.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { resortPitches, triageDisabled, TRIAGE_DISABLED_NOTICE } from "@/lib/os/setter/triage";

export async function resortPitchesAction(): Promise<{ notice?: string; error?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  if (triageDisabled()) return { notice: `${TRIAGE_DISABLED_NOTICE}.` };
  try {
    const r = await resortPitches(workspaceId, { limit: 200 });
    revalidatePath("/os/inbox");
    const n = r.moved.length;
    return { notice: n ? `Moved ${n} to Pitches.` : `Looked at ${r.looked}. No pitches found.` };
  } catch (err) {
    return { error: err instanceof Error ? `Re-sort failed: ${err.message}` : "Re-sort failed." };
  }
}
