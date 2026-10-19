import Link from "next/link";
import ExperimentForm from "@/components/os/experiments/experiment-form";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { createOptions } from "@/lib/os/experiments/data";
import { suggestionsFor } from "@/lib/os/experiments/suggestions";
import { ENTRY_PATHS, LINE_KEYS } from "@/lib/os/experiments/types";

export const dynamic = "force-dynamic";

export default async function NewExperimentPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const options = await createOptions(workspaceId);
  const suggestions = {
    opener: suggestionsFor("j_opener", "any"),
    ...Object.fromEntries(LINE_KEYS.map((l) => [l.key, suggestionsFor("line", l.key)])),
  };

  return (
    <>
      <PageHead
        eyebrow="Experiments"
        title="New test"
        description="Your method stays the same. A test only swaps the words of one line."
        actions={
          <Link href="/os/automations/tests" className="os-button ghost">
            Cancel
          </Link>
        }
      />
      <ExperimentForm
        options={options}
        entries={ENTRY_PATHS.map((e) => ({ key: e.key, label: e.label }))}
        lines={LINE_KEYS.map((l) => ({ key: l.key, label: l.label }))}
        suggestions={suggestions}
      />
    </>
  );
}
