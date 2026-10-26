import Link from "next/link";
import { PageHead } from "@/components/os/page-head";
import { EmptyState } from "@/components/os/ui/empty-state";

// Placeholder for the Pipeline screen (dm-crm slice 4, issue 019): the
// Contacts+Pipeline stream builds the board here. Until then the board lives
// on Contacts.
export const dynamic = "force-dynamic";

export default function PipelinePage() {
  return (
    <div className="os-pipeline">
      <PageHead title="Pipeline" />
      <EmptyState title="The pipeline board is on its way." action={<Link href="/os/contacts" className="os-button">Open the board on Contacts</Link>} />
    </div>
  );
}
