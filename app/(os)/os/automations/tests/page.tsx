import { redirect } from "next/navigation";

/** Old URL: line tests live in Knowledge bases › setter › Tests now, and a
 *  campaign's opener test shows on its row in Campaigns. */
export default function OldTestsPage() {
  redirect("/os/knowledge?s=tests");
}
