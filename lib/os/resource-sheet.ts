// The resource sheet's save step, pure so it's testable: save, then hand the
// saved resource to onSaved (the broadcast picker hooks in here, Part C 024).

export interface SheetSaveResult<R> {
  error?: string;
  resource?: R;
}

export async function saveSheet<F, R>(
  save: (form: F, agentIds: string[]) => Promise<SheetSaveResult<R>>,
  form: F,
  agentIds: string[],
  onSaved: (resource: R) => void
): Promise<string | null> {
  const r = await save(form, agentIds);
  if (r.error || !r.resource) return r.error ?? "That didn't save. Try again.";
  onSaved(r.resource);
  return null;
}

/** The confirm when an agent is unticked. */
export function removeAgentQuestion(name: string): string {
  return `Remove from ${name}? ${name} stops offering it, and ${name}'s sequences stop sending it.`;
}
