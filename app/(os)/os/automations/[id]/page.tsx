import Link from "next/link";
import { notFound } from "next/navigation";
import BuilderFrame from "@/components/os/automations/builder-frame";
import SetterPicker from "@/components/os/automations/setter-picker";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { campaignResourceChoice, campaignSetterChoice } from "@/lib/os/automations-data";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function EditAutomationPage({ params }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const { id } = await params;
  const [choice, res] = await Promise.all([campaignSetterChoice(workspaceId, id), campaignResourceChoice(workspaceId, id)]);
  if (!choice) notFound();

  return (
    <>
      <PageHead
        eyebrow="Automations"
        title="Edit automation"
        actions={
          <Link href="/os/automations" className="os-button ghost">
            Back to automations
          </Link>
        }
      />
      <SetterPicker automationId={id} {...choice} resources={res.resources} resourceId={res.selected} />
      <BuilderFrame mode="edit" campaignId={id} />
    </>
  );
}
