"use client";

// Chat tab (Contacts push panel, ContactsA): the same Instagram-style thread
// and one composer as the Inbox, loaded when the tab opens. Owner: S1.

import { useCallback, useEffect, useState } from "react";
import { loadChatTab, type ChatTabData } from "@/app/(os)/os/inbox/actions";
import Composer from "@/components/os/thread/composer";
import ThreadView from "@/components/os/thread/thread-view";
import { EmptyState } from "@/components/os/ui";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";

export default function ChatTab({ data }: { data: ContactPanelData }) {
  const [loaded, setChat] = useState<ChatTabData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    loadChatTab(data.contactId)
      .then((r) => {
        if ("error" in r) setError(r.error);
        else {
          setError(null);
          setChat(r);
          setNow(Date.now());
        }
      })
      .catch(() => setError("The chat didn't load. Try again."));
  }, [data.contactId]);

  useEffect(() => {
    load();
  }, [load]);

  // Another contact's chat is still loading.
  const chat = loaded?.contactId === data.contactId ? loaded : null;

  if (!data.conversationId) return <EmptyState title="No conversation yet" />;
  if (error && !chat) return <EmptyState title={error} />;
  if (!chat) return <p className="os-chat-loading" aria-busy="true">Loading…</p>;

  const name = data.username ?? data.fullName ?? "them";
  return (
    <div className="os-chat">
      <ThreadView data={chat.thread} contactId={chat.contactId} who={name} avatarUrl={data.avatarUrl} now={now} />
      <Composer
        key={chat.draft ? `${chat.draft.id}:${chat.draft.bubbles.join("|")}` : "own"}
        contactId={chat.contactId}
        igUserId={chat.igUserId}
        conversationId={chat.conversationId}
        who={chat.who}
        draft={chat.draft}
        draftBlockedReason={chat.draftBlockedReason}
        setterName={chat.thread.extras.setterName}
        onSettled={load}
      />
    </div>
  );
}
