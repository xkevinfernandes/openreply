import Link from "next/link";
import BuilderFrame from "@/components/os/automations/builder-frame";
import { PageHead } from "@/components/os/page-head";

// One header row: the title on the left, Cancel and the builder's own Go Live
// together on the right (.os-auto-newpage in automations.css lays them out).
export default function NewAutomationPage() {
  return (
    <div className="os-auto-newpage">
      <PageHead eyebrow="Automations" title="New automation" description="Runs on its own. Add a setter after saving." />
      <Link href="/os/automations" className="os-button ghost os-auto-cancel">
        Cancel
      </Link>
      <BuilderFrame mode="new" />
    </div>
  );
}
