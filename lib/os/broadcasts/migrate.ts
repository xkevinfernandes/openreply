// The old Friday list (Contact.onFriday) is now the follow-up-friday tag the
// broadcast audience reads. The SQL migration (20261020020000_os_ui_data)
// moved existing rows once; this keeps the two in step for writes that still
// come through the old "Add to Friday" control.

import { FOLLOW_UP_FRIDAY } from "@/lib/os/broadcasts/types";

/** The tags after turning Friday on or off. Idempotent; other tags untouched. */
export function fridayTags(tags: string[], on: boolean, tag: string = FOLLOW_UP_FRIDAY.tag): string[] {
  const without = tags.filter((t) => t !== tag);
  return on ? [...without, tag] : without;
}

/** Is this contact on the Friday list (the tag, or the legacy flag not yet migrated)? */
export function onFridayList(c: { tags: string[]; onFriday?: boolean | null }, tag: string = FOLLOW_UP_FRIDAY.tag): boolean {
  return c.tags.includes(tag) || Boolean(c.onFriday);
}
