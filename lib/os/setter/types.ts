// Shapes shared by J's modules. The catalog row mirrors one entry of
// resources.json (DM Setter/scripts/dms/resources.json), field names as-is.

export interface CatalogTrigger {
  surface?: "comment" | "story" | "dm" | string;
  post_id?: string | null;
  keyword?: string | null;
  automation_id?: string | null;
}

export interface CatalogRow {
  slug: string;
  type?: "resource" | "setter" | string;
  name?: string;
  status?: string;
  engine?: string;
  mode?: string;
  lead_magnet?: string;
  resource_url?: string;
  resource_kind?: string;
  youtube_id?: string;
  blurb?: string;
  for_setter?: string;
  next_step?: string;
  match?: string[];
  triggers?: CatalogTrigger[];
  opener?: { message?: string; variations?: string[] };
  zernio?: {
    keyword?: string;
    button_title?: string;
    button_url?: string;
    dm_message?: string;
    dm_message_variations?: string[];
    click_tag?: string;
  };
  dm?: { message?: string; button?: string };
}

export interface Catalog {
  tag_options?: string[];
  resources: CatalogRow[];
}
