"use client";

// The contact's workflow run in the Inbox (InboxPaused board):
//  - RunLine: contact panel "Workflow: <name> · <step> · Paused/Active".
//  - PausedNotice: the thread line "Workflow paused · you replied" + Resume.
// Both read one shared, cached fetch per contact; Resume refreshes both.

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { loadContactRun, loadFailedRuns, resumeContactRun } from "@/app/(os)/os/automations/workflows/actions";
import { WfIcon } from "@/components/os/workflows/icons";
import type { ContactRun } from "@/components/os/workflows/types";
import "@/components/os/workflows/workflows.css";

const EVENT = "os:workflow-run";
const cache = new Map<string, Promise<ContactRun | null>>();

function fetchRun(contactId: string, fresh = false): Promise<ContactRun | null> {
  if (fresh || !cache.has(contactId)) cache.set(contactId, loadContactRun(contactId).catch(() => null));
  return cache.get(contactId)!;
}

function useContactRun(contactId: string | null) {
  const [run, setRun] = useState<ContactRun | null>(null);
  useEffect(() => {
    if (!contactId) return;
    let live = true;
    const load = (fresh: boolean) => void fetchRun(contactId, fresh).then((r) => live && setRun(r));
    load(false);
    const onChange = (e: Event) => {
      if ((e as CustomEvent<string>).detail === contactId) load(false);
    };
    window.addEventListener(EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, [contactId]);
  return contactId ? run : null;
}

function useResume(contactId: string) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const resume = () =>
    start(async () => {
      setError(null);
      const r = await resumeContactRun(contactId);
      if (r.error !== undefined) setError(r.error);
      cache.set(contactId, loadContactRun(contactId).catch(() => null));
      window.dispatchEvent(new CustomEvent(EVENT, { detail: contactId }));
    });
  return { pending, error, resume };
}

/** Contact panel: which workflow, which step, Paused or Active. */
export function RunLine({ contactId }: { contactId: string }) {
  const run = useContactRun(contactId);
  if (!run) return null;
  const paused = run.status === "paused";
  return (
    <Link
      href={`/os/automations/workflows/${run.workflowId}`}
      className="wf-runline"
      aria-label={`Workflow: ${run.workflowName} · ${run.stepLabel} step · ${paused ? "Paused" : "Active"}`}
      title={`Workflow: ${run.workflowName}`}
    >
      <WfIcon name="randomizer" size={13} />
      <span className="wf-runline-name">
        {run.workflowName} <span className="wf-ghost">· {run.stepLabel}</span>
      </span>
      <span className="wf-runline-st" data-paused={paused || undefined}>
        <span className="wf-runline-dot" />
        {paused ? "Paused" : "Active"}
      </span>
    </Link>
  );
}

/** Thread: shown under the newest message while the run waits on Kevin. */
export function PausedNotice({ contactId }: { contactId: string | null }) {
  const run = useContactRun(contactId);
  const { pending, error, resume } = useResume(contactId ?? "");
  if (!contactId || !run || run.status !== "paused") return null;
  return (
    <div className="wf-paused" role="status">
      <WfIcon name="pause" size={12} />
      <span>{error ?? "Workflow paused · you replied"}</span>
      <button type="button" className="wf-paused-btn" disabled={pending} aria-busy={pending} onClick={resume} title={`Resume ${run.workflowName}: J reads what you wrote and carries on`}>
        <WfIcon name="resume" size={11} />
        Resume
      </button>
    </div>
  );
}

/** Inbox list: contactId → failReason for the threads on screen. */
export function useFailedRuns(contactIds: string[]): Record<string, string> {
  const key = [...contactIds].sort().join(",");
  const [failed, setFailed] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let live = true;
    void loadFailedRuns(key.split(",")).then((r) => live && setFailed(r));
    return () => {
      live = false;
    };
  }, [key]);
  return failed;
}

/** The red dot on a thread row; the reason on hover. */
export function FailDot({ reason }: { reason: string | undefined }) {
  if (!reason) return null;
  return <span className="os-dot wf-faildot" data-tone="bad" role="img" aria-label={`Workflow failed: ${reason}`} title={`Workflow failed: ${reason}`} />;
}
