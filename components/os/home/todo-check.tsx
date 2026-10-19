"use client";

// A "Yours to do" task checkbox: ticking it closes the task (Follow-ups' action).

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeTask } from "@/app/(os)/os/follow-ups/actions";

export default function TodoCheck({ taskId, label }: { taskId: string; label: string }) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={done}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.checked;
        setDone(next);
        start(async () => {
          const r = await completeTask(taskId, next);
          if (r?.error) setDone(!next);
          router.refresh();
        });
      }}
    />
  );
}
