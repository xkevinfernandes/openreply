// J's draft output -> ContactFieldValue (source "j"). Wave-0 stub: the call
// site in events-hooks.onDraftSent is wired; S3 fills this in (never
// overwrite a user value, then trigger a CRM sync).

export interface CaptureInput {
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  draftId: string;
  /** Draft.raw (J's output JSON; `fields` once prompt.ts asks for them). */
  raw: unknown;
}

/** Returns how many values were written. */
export async function captureFields(input: CaptureInput): Promise<number> {
  void input;
  return 0;
}
