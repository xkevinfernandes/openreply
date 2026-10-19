// The voice bank v1 lines Kevin records (docs/sp/dms/2026-10-17-setter-v2-plan.md,
// "Voice bank v1"). A setter's Voice notes section starts with these as empty
// slots: record each one exactly as written, then switch it on.

export interface VoiceSlot {
  slot: string;
  stage: string;
  phrase: string;
  leadIn?: boolean;
}

export const VOICE_SLOTS: VoiceSlot[] = [
  { slot: "v01", stage: "Open", phrase: "hey, appreciate you reaching out.. what are you building right now?" },
  { slot: "v02", stage: "Value", phrase: "honestly, what's the part eating most of your time right now?" },
  { slot: "v03", stage: "Permission", phrase: "do you mind if I ask you a couple things? you got me curious" },
  { slot: "v04", stage: "Qualify", phrase: "what's the main goal with the business right now?" },
  { slot: "v05", stage: "Qualify", phrase: "and what's been the biggest thing in the way?" },
  { slot: "v06", stage: "Value send", phrase: "not gonna explain it all over DMs, I've got a video that walks through exactly that, want me to send it?" },
  { slot: "v07", stage: "After value", phrase: "did you get a chance to watch it? curious what you thought" },
  { slot: "v08", stage: "Invite", phrase: "easier to just show you.. want to jump on a quick call? just want to see where you're at" },
  { slot: "v09", stage: "Link sent", phrase: "just sent you the link, grab whatever time works and let me know once you've booked" },
  { slot: "v10", stage: "Confirmed", phrase: "perfect, you're in, looking forward to it" },
  { slot: "v11", stage: "Day before", phrase: "hey, still good for tomorrow?" },
  { slot: "v12", stage: "Day of", phrase: "quick heads up, see you later today, link's in your email" },
  { slot: "v13", stage: "Follow-up", phrase: "hey, still with me?" },
  { slot: "v14", stage: "Context", phrase: "just headed to the gym, quick one..", leadIn: true },
  { slot: "v15", stage: "Breakup", phrase: "haven't heard back, all good, if things change just let me know" },
];
