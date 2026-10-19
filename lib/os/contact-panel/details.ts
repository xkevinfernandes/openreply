// Details tab data (fields n/m, sync state, Kit tags, keywords, lead magnets).
// Wave-0 stub; owner: S3.

export interface ContactDetailsData {
  contactId: string;
}

export async function loadContactDetails(workspaceId: string, contactId: string): Promise<ContactDetailsData> {
  void workspaceId;
  return { contactId };
}
