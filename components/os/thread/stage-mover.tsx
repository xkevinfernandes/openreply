"use client";

// Performs "move-stage" from the contact panel's pill (and the ⌘K palette)
// on screens that host the panel next to a thread. Owner: S1.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveContactStage } from "@/app/(os)/os/inbox/actions";
import { useOsCommand } from "@/components/os/keys";

export default function StageMover({ contactId }: { contactId: string | null }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useOsCommand("move-stage", (d) => {
    const id = d.contactId ?? contactId;
    if (!id || !d.stage) return;
    setError(null);
    start(async () => {
      const r = await moveContactStage(id, d.stage!).catch(() => ({ error: "The stage didn't save. Try again." }));
      if (r.error) setError(r.error);
      router.refresh();
    });
  });
  return error ? (
    <p className="os-ix-toast" role="alert" onClick={() => setError(null)}>
      {error}
    </p>
  ) : null;
}
