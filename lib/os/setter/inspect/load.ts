// Loads one draft for the Inspect drawer: its trace (Draft.raw.trace) or, for
// a legacy draft, what it kept. Scoped to the workspace; read only.

import { prisma } from "@/lib/db/client";
import { experimentStore } from "@/lib/os/experiments/store";
import { osMockEnabled } from "@/lib/os/mock";
import { isDraftTrace } from "@/lib/os/setter/agent/trace";
import { MOCK_VARIANT_LABELS, mockTrace } from "@/lib/os/setter/inspect/mock";
import { viewFromLegacy, viewFromTrace, type InspectView } from "@/lib/os/setter/inspect/view";
import { mockDraftRaw, setterStore } from "@/lib/os/setter/store";

const traceOf = (raw: unknown) => (raw && typeof raw === "object" ? (raw as { trace?: unknown }).trace : null);

/** Variant id → its label ("A", "B"), for the lines this trace carries. */
async function variantLabels(workspaceId: string, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  try {
    const out: Record<string, string> = {};
    for (const e of await experimentStore().list(workspaceId)) for (const v of e.variants) if (ids.includes(v.id)) out[v.id] = v.label;
    return out;
  } catch {
    return {};
  }
}

export async function loadInspect(workspaceId: string, draftId: string): Promise<InspectView | null> {
  if (osMockEnabled()) {
    if (draftId === "mock-draft-maya") return viewFromTrace(mockTrace(), { source: "draft", variantLabels: MOCK_VARIANT_LABELS, stage: "qualify" });
    const d = await setterStore().getDraft(draftId, workspaceId);
    if (!d) return null;
    const t = traceOf(mockDraftRaw(draftId));
    if (isDraftTrace(t)) return viewFromTrace(t, { source: "draft", stage: d.setterStage });
    return viewFromLegacy({ at: d.createdAt, bubbles: d.bubbles, reasoning: d.reasoning, stage: d.setterStage, backend: d.backend, model: null, inputTokens: null, outputTokens: null, raw: mockDraftRaw(draftId) });
  }
  const d = await prisma.draft.findFirst({
    where: { id: draftId, workspaceId },
    select: { raw: true, bubbles: true, reasoning: true, setterStage: true, backend: true, model: true, inputTokens: true, outputTokens: true, createdAt: true },
  });
  if (!d) return null;
  const t = traceOf(d.raw);
  if (isDraftTrace(t)) {
    const labels = await variantLabels(
      workspaceId,
      t.lines.assigned.map((l) => l.variantId)
    );
    return viewFromTrace(t, { source: "draft", variantLabels: labels, stage: d.setterStage });
  }
  return viewFromLegacy({
    at: d.createdAt.toISOString(),
    bubbles: d.bubbles,
    reasoning: d.reasoning,
    stage: d.setterStage,
    backend: d.backend,
    model: d.model,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    raw: d.raw,
  });
}
