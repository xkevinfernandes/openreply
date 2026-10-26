import Link from "next/link";
import { notFound } from "next/navigation";
import BuilderFrame from "@/components/os/automations/builder-frame";
import SetterPicker from "@/components/os/automations/setter-picker";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { campaignResourceChoice, campaignSetterChoice } from "@/lib/os/automations-data";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// One header row: the breadcrumb and title on the left, the builder's own
// keyword + Live pill beside the title, and its Stop + Save changes on the
// right (.os-auto-newpage.os-auto-editpage in automations.css lays them out).
// The header is PageHead's markup (.os-head) with the eyebrow as a breadcrumb.
export default async function EditAutomationPage({ params }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const { id } = await params;
  const [choice, res] = await Promise.all([campaignSetterChoice(workspaceId, id), campaignResourceChoice(workspaceId, id)]);
  if (!choice) notFound();

  return (
    <div className="os-auto-newpage os-auto-editpage">
      <header className="os-head">
        <div>
          <nav aria-label="Breadcrumb" className="os-eyebrow os-auto-crumbs">
            <Link href="/os/automations">Automations</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Edit</span>
          </nav>
          <h1>Edit automation</h1>
        </div>
      </header>
      <SetterPicker automationId={id} {...choice} resources={res.resources} resourceId={res.selected} />
      <BuilderFrame mode="edit" campaignId={id} />
    </div>
  );
}
