// The pure half of lib/os/connections.ts (no database), so client
// components can use the problem words and fix labels.

/** What the one fix button does: Zernio's connect flow, the webhook repair,
 *  or (Zernio itself not set up) the Zernio key form. */
export type InstagramFix = "connect" | "webhook" | "zernio";

export interface InstagramProblem {
  text: string;
  fix: InstagramFix;
}

export interface InstagramAccountState {
  /** The InstagramAccount id; null for the OS_MOCK sample. */
  id: string | null;
  username: string;
  provider: string;
  tokenExpiresAt: Date | null;
  zernioAccountId: string | null;
  webhookSubscribed: boolean;
  automations: number;
  connectedAt: Date | null;
}

export interface ZernioState {
  configured: boolean;
  webhookReady: boolean;
}

export interface InstagramState {
  account: InstagramAccountState | null;
  zernio: ZernioState;
  problems: InstagramProblem[];
  /** OS_MOCK sample: fixes run in memory, nothing calls Zernio. */
  sample: boolean;
}

/** The account's problems, worst first, each with the fix that clears it. */
export function instagramProblems(account: Omit<InstagramAccountState, "id" | "automations" | "connectedAt"> | null, zernio: ZernioState, now: Date): InstagramProblem[] {
  if (!account) return [];
  const out: InstagramProblem[] = [];
  if (account.provider === "ZERNIO") {
    if (!zernio.configured) out.push({ text: "Zernio key missing", fix: "zernio" });
    else if (!zernio.webhookReady) out.push({ text: "Zernio webhook not set up", fix: "zernio" });
    else if (!account.zernioAccountId) out.push({ text: "Not linked in Zernio", fix: "connect" });
  } else if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < now.getTime()) {
    out.push({ text: "Token expired", fix: "connect" });
  }
  if (!account.webhookSubscribed) out.push({ text: "Webhook not subscribed", fix: "webhook" });
  return out;
}

/** The button's words for a fix. */
export function fixLabel(fix: InstagramFix): string {
  return fix === "webhook" ? "Fix webhook" : fix === "zernio" ? "Set up Zernio" : "Reconnect";
}

/** "@claudepreneur · connected", "@claudepreneur · Webhook not subscribed", "Not connected". */
export function instagramLine(state: Pick<InstagramState, "account" | "problems">): string {
  if (!state.account) return "Not connected";
  return `@${state.account.username} · ${state.problems[0]?.text ?? "connected"}`;
}
