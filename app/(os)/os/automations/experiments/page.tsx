import { redirect } from "next/navigation";

/** Old URL: line tests live in Knowledge bases › setter › Tests now. */
export default function ExperimentsRedirect() {
  redirect("/os/knowledge?s=tests");
}
