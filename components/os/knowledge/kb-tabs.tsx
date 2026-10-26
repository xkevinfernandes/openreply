import Link from "next/link";
import { KbIcon } from "@/components/os/knowledge/icons";
import { NewSetter } from "@/components/os/knowledge/setter-list-actions";
import { SetterChatToggle } from "@/components/os/knowledge/setter-chat";

/** Setters · Resources, under the header. */
export function KbTabs({ active, settersHref = "/os/knowledge" }: { active: "setters" | "resources"; settersHref?: string }) {
  return (
    <nav className="kb-tabs" aria-label="Knowledge bases">
      <Link href={settersHref} aria-current={active === "setters" ? "page" : undefined}>
        Setters
      </Link>
      <Link href="/os/resources" aria-current={active === "resources" ? "page" : undefined}>
        Resources
      </Link>
    </nav>
  );
}

interface SetterBarProps {
  id: string;
  name: string;
  setters: { id: string; name: string }[];
  /** Kept when switching setter, so you stay on the same file. */
  query?: string;
  active?: "knowledge" | "sandbox";
}

/** Knowledge bases › J, the setter switcher, Download .md and Test in sandbox. */
export function SetterBar({ id, name, setters, query = "", active = "knowledge" }: SetterBarProps) {
  return (
    <>
      <header className="kb-bar">
        <nav aria-label="Breadcrumb" className="kb-crumb">
          <Link href="/os/knowledge">Knowledge bases</Link>
          <KbIcon name="chevron" size={12} />
          {active === "sandbox" ? <Link href={`/os/knowledge/${id}`}>{name}</Link> : <span className="kb-crumb-now">{name}</span>}
          {active === "sandbox" && (
            <>
              <KbIcon name="chevron" size={12} />
              <span className="kb-crumb-now">Sandbox</span>
            </>
          )}
        </nav>
        <div role="tablist" aria-label="Setter" className="kb-switch">
          {setters.map((s) => (
            <Link
              key={s.id}
              role="tab"
              aria-selected={s.id === id}
              href={`/os/knowledge/${s.id}${active === "sandbox" ? "/sandbox" : query}`}
              className="kb-switch-tab"
            >
              <span className="kb-mark" data-on={s.id === id ? "true" : undefined} aria-hidden="true">
                {s.name.trim().charAt(0).toUpperCase()}
              </span>
              {s.name}
            </Link>
          ))}
          <NewSetter setters={setters} compact />
        </div>
      </header>
      {/* Setters · Resources with the actions on the same row: the setter bar
          above stays one row even with the chat open (R2-5). */}
      <div className="kb-subbar">
        <KbTabs active="setters" settersHref={`/os/knowledge/${id}`} />
        <div className="kb-bar-acts">
          <a href={`/os/knowledge/${id}/export`} className="kb-btn kb-btn-dl" download>
            <KbIcon name="download" />
            Download .md
          </a>
          <SetterChatToggle />
          {active === "knowledge" && (
            <Link href={`/os/knowledge/${id}/sandbox`} className="kb-btn kb-btn-p">
              <KbIcon name="play" />
              Test in sandbox
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/** The sandbox page's header (same bar, the sandbox crumb). */
export function SetterHead({ id, name, setters = [{ id, name }] }: { id: string; name: string; setters?: { id: string; name: string }[]; active?: string }) {
  return <SetterBar id={id} name={name} setters={setters} active="sandbox" />;
}
