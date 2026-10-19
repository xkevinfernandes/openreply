import { ConversationSkeleton, ThreadListSkeleton } from "@/components/os/ui/skeleton";

export default function InboxLoading() {
  return (
    <div className="os-ix" data-thread-open="false" data-list="full">
      <ThreadListSkeleton />
      <ConversationSkeleton />
    </div>
  );
}
