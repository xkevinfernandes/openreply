import Link from "next/link";
import { KbIcon } from "@/components/os/knowledge/icons";
import SetterInterview from "@/components/os/knowledge/interview";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** New setter: seven questions → starter docs to review → a new setter. */
export default async function NewSetterPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const setters = await prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return (
    <div className="kb-ws">
      <header className="kb-bar">
        <nav aria-label="Breadcrumb" className="kb-crumb">
          <Link href="/os/knowledge">Knowledge bases</Link>
          <KbIcon name="chevron" size={12} />
          <span className="kb-crumb-now">New setter</span>
        </nav>
      </header>
      <SetterInterview setters={setters} />
    </div>
  );
}
