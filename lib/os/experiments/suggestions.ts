// Starting variants for the create form, drawn from the research
// (docs/research/2026-10-17-setdm-reel-and-max-inhouse-dm-method.md §2, §4).
// Kevin's method stays: these are only lines to test, never a new script.

import type { SlotKind } from "@/lib/os/experiments/types";

export interface Suggestion {
  style: string;
  label: string;
  why: string;
  text: string;
}

const OPENERS: Suggestion[] = [
  {
    style: "references_action",
    label: "References what they did",
    why: "SetDM: openers that point at what they did (a poll vote, a comment) got 43-65% replies vs 21-29%.",
    text: "saw you commented on the reel, what made you want it?",
  },
  {
    style: "specific_question",
    label: "One specific question",
    why: "SetDM's best opener was one specific question (61% reply, 6% booked, on 64 sends).",
    text: "what's the main thing you're building with claude right now?",
  },
  {
    style: "pattern_interrupt",
    label: "Pattern interrupt",
    why: "Max: never open with just \"hey\". Say something they don't expect.",
    text: "ok you're the 3rd person today asking for this, what's everyone building lol",
  },
  {
    style: "generic_thanks",
    label: "Generic thanks (control)",
    why: "The \"appreciate the follow\" style carries volume but booked 0.3-1%. Useful as the baseline.",
    text: "hey, appreciate you grabbing it. what are you working on at the moment?",
  },
];

const LINES: Record<string, Suggestion[]> = {
  permission_ask: [
    { style: "soft", label: "Soft", why: "Plain and low pressure.", text: "mind if i ask you something about that?" },
    { style: "curious", label: "Curious", why: "Names the reason for asking.", text: "can i ask, what's made that hard so far?" },
  ],
  value_offer: [
    {
      style: "walkthrough",
      label: "Walkthrough",
      why: "Max: \"I've got something that solves exactly that, want a quick walkthrough?\"",
      text: "i've got a quick video that shows exactly that, want me to send it?",
    },
    { style: "no_dm_essay", label: "Too long for DMs", why: "Max's value transition.", text: "not gonna explain it over dms, too much back and forth. want the short video?" },
  ],
  invite: [
    {
      style: "screen_share",
      label: "Screen share",
      why: "Max: never say \"call\" or \"strategy session\". Say \"I can share my screen\".",
      text: "easier to show you than spam you in dms. want me to share my screen for 15 min this week?",
    },
    { style: "between_meetings", label: "Between meetings", why: "Max: \"got 15 min between meetings tomorrow\".", text: "got 15 min tomorrow if you want me to walk you through it" },
  ],
  follow_up_1: [
    { style: "value_first", label: "Value first", why: "Max's post-ghost order: value first, then proof, then a direct ask.", text: "found this and thought of what you're building" },
    { style: "pressure_remover", label: "Pressure remover", why: "Zero guilt, a door a friend would open.", text: "no stress if you're slammed, just curious how it went" },
  ],
};

export function suggestionsFor(kind: SlotKind, ref: string): Suggestion[] {
  if (kind === "line") return LINES[ref] ?? [];
  return OPENERS;
}
