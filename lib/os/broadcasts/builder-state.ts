// Client-safe helpers for the broadcast builder's edit state.
//
// Two things made edits get lost when they were made in a different order
// (rename, then pick a tag, then Save):
//  1. Renaming saves on blur. Clicking Save while the name still had focus
//     fired the rename first, which disabled every button mid-click, so the
//     Save click landed on a disabled button and was dropped.
//  2. Every saved field remounted every step form, so saving one step threw
//     away what you had typed (unsaved) in another.
// The fix: saves run one after another through a queue (a rename never blocks
// a click), and each step remounts only when its own saved fields change.

import type { BroadcastView } from "@/lib/os/broadcasts/types";

/** Runs async jobs strictly in the order they were added; a failing job doesn't stop the next. */
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job, job);
    tail = run.catch(() => undefined);
    return run;
  };
}

type StampFields = Pick<
  BroadcastView,
  "status" | "startMode" | "sendDate" | "windowStart" | "windowEnd" | "audienceTagId" | "contactIds" | "bubbles" | "followupTemplate" | "followupDelayMin" | "personaliseMode" | "variations" | "setterId"
>;

/** One remount key per step: a step's form resets only when what it edits was saved (or the status moved). */
export function stepStamps(b: StampFields) {
  const k = (...v: unknown[]) => JSON.stringify([b.status, ...v]);
  return {
    start: k(b.startMode, b.sendDate, b.windowStart, b.windowEnd),
    who: k(b.audienceTagId, b.contactIds),
    messages: k(b.bubbles, b.followupTemplate, b.followupDelayMin),
    personalise: k(b.personaliseMode, b.variations, b.setterId),
  };
}
