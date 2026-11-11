import { notFound } from "next/navigation";
import BuilderFrame from "@/components/os/automations/builder-frame";
import SetterPicker from "@/components/os/automations/setter-picker";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { campaignResourceChoice, campaignSetterChoice } from "@/lib/os/automations-data";
import { PageHead } from "@/components/os/page-head";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// One header row: the breadcrumb and title on the left, the builder's own
// keyword + Live pill beside the title, and its Stop + Save changes on the
// right (.os-auto-newpage.os-auto-editpage in automations.css lays them out).
export default async function EditAutomationPage({ params }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const { id } = await params;
  const [choice, res] = await Promise.all([campaignSetterChoice(workspaceId, id), campaignResourceChoice(workspaceId, id)]);
  if (!choice) notFound();

  return (
    <div className="os-auto-newpage os-auto-editpage">
      <PageHead back={{ href: "/os/automations", label: "Automations" }} title="Edit automation" />
      <SetterPicker automationId={id} {...choice} resources={res.resources} resourceId={res.selected} />
      <BuilderFrame mode="edit" campaignId={id} />
    </div>
  );
}
