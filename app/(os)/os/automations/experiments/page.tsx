import { redirect } from "next/navigation";

/** Old URL: Experiments is now Automations › Tests. */
export default function ExperimentsRedirect() {
  redirect("/os/automations/tests");
}
