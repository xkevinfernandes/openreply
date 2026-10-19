import Link from "next/link";
import BuilderFrame from "@/components/os/automations/builder-frame";
import { PageHead } from "@/components/os/page-head";

export default function NewAutomationPage() {
  return (
    <>
      <PageHead
        eyebrow="Automations"
        title="New automation"
        description="Runs on its own. Add a setter after saving."
        actions={
          <Link href="/os/automations" className="os-button ghost">
            Cancel
          </Link>
        }
      />
      <BuilderFrame mode="new" />
    </>
  );
}
