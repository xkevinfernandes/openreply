import Link from "next/link";
import BuilderFrame from "@/components/os/automations/builder-frame";
import { PageHead } from "@/components/os/page-head";

export default function NewAutomationPage() {
  return (
    <>
      <PageHead
        eyebrow="Automations"
        title="New automation"
        description="Pick the post, the keyword and what they get. Once they reply, the account's default setter answers; change it after saving."
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
