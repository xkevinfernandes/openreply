export type CrmTag = { id: string; name: string };

/// A lead as captured in a DM. `fields` maps the list's own custom-field keys to
/// values (Kit custom fields, later GHL custom values).
export type CrmLead = {
  email: string;
  firstName?: string | null;
  fields?: Record<string, string>;
  tagIds?: string[];
};

/// One email list / CRM. Kit today; Go High Level implements the same shape.
export interface CrmProviderClient {
  verify(): Promise<void>;
  listTags(): Promise<CrmTag[]>;
  upsertLead(lead: CrmLead): Promise<void>;
}
