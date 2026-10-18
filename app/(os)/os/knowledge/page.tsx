import Link from "next/link";
import { KbTabs } from "@/components/os/knowledge/kb-tabs";
import { ImportButton, NewSetter } from "@/components/os/knowledge/setter-list-actions";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { listSetterCards } from "@/lib/os/knowledge";

export const dynamic = "force-dynamic";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export default async function KnowledgePage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const setters = await listSetterCards(workspaceId);

  return (
    <>
      <PageHead
        title="Knowledge bases"
        description="One per setter: voice, offers, funnel, lead magnets, examples and voice corrections. The Setting Script is the shared method and ships with the app."
        actions={setters.length ? <NewSetter setters={setters.map((s) => ({ id: s.id, name: s.name }))} /> : null}
      />
      <KbTabs active="setters" />

      {!setters.length ? (
        <div className="os-empty os-kb-empty">
          <strong>No knowledge base yet</strong>
          <p>
            Until there is one, J drafts from the files bundled with the app (the claudepreneur setter). Import them to edit them here, or
            start from scratch.
          </p>
          <div className="os-kb-inline">
            <ImportButton />
            <NewSetter setters={[]} />
          </div>
        </div>
      ) : (
        <ul className="os-kb-cards">
          {setters.map((s) => (
            <li key={s.id}>
              <Link href={`/os/knowledge/${s.id}`} className="os-kb-card">
                <span className="os-kb-card-top">
                  <span className="os-kb-card-mark" aria-hidden="true">
                    {s.name.slice(0, 1).toUpperCase()}
                  </span>
                  {s.defaultFor && <span className="chip ready">Default · {s.defaultFor}</span>}
                </span>
                <strong className="os-kb-card-name">{s.name}</strong>
                <span className="os-kb-card-stats">
                  <span>
                    {s.openOffers} of {plural(s.offers, "offer")} open
                  </span>
                  <span>{plural(s.leadMagnets, "lead magnet")}</span>
                  <span>{plural(s.corrections, "correction")}</span>
                  {s.campaigns > 0 && <span>{plural(s.campaigns, "campaign")}</span>}
                </span>
                <span className="os-kb-card-foot">
                  Edited {new Date(s.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </Link>
              <Link href={`/os/knowledge/${s.id}/sandbox`} className="os-kb-card-test">
                Test this setter
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
