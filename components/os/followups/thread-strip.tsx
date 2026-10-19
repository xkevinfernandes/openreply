// Removed (FollowupsA): the strip of follow-up text on a thread is gone; the
// contact panel's Follow-ups tab and its "next follow-up" line replace it.
// Kept as an empty component so the Inbox page still builds until it drops
// the import; Q deletes this file.
import type { ThreadFollowups } from "@/lib/os/sequences/view";

export default function ThreadStrip(props: { contactId: string; data: ThreadFollowups; now: number }) {
  void props;
  return null;
}
