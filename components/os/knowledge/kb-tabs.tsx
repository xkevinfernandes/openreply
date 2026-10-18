import Link from "next/link";
import { PageHead } from "@/components/os/page-head";

export function KbTabs({ active }: { active: "setters" | "resources" }) {
  return (
    <nav className="os-kb-tabs" aria-label="Knowledge bases">
      <Link href="/os/knowledge" aria-current={active === "setters" ? "page" : undefined}>
        Setters
      </Link>
      <Link href="/os/knowledge/resources" aria-current={active === "resources" ? "page" : undefined}>
        Resources
      </Link>
    </nav>
  );
}

export function SetterHead({ id, name, active }: { id: string; name: string; active: "knowledge" | "sandbox" }) {
  return (
    <>
      <PageHead
        eyebrow="Knowledge base"
        title={name}
        actions={
          <div className="os-kb-inline">
            <Link href="/os/knowledge" className="os-button ghost">
              All setters
            </Link>
            <a href={`/os/knowledge/${id}/export`} className="os-button" download>
              Download as markdown
            </a>
          </div>
        }
      />
      <nav className="os-kb-tabs" aria-label="This setter">
        <Link href={`/os/knowledge/${id}`} aria-current={active === "knowledge" ? "page" : undefined}>
          Knowledge
        </Link>
        <Link href={`/os/knowledge/${id}/sandbox`} aria-current={active === "sandbox" ? "page" : undefined}>
          Test this setter
        </Link>
      </nav>
    </>
  );
}
