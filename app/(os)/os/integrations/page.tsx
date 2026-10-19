import { redirect } from "next/navigation";

// Integrations moved inside Settings (spec: Nav, 7 items).
export default function IntegrationsPage() {
  redirect("/os/settings?tab=integrations");
}
