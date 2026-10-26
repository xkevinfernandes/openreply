// Spam heuristic on inbound DM text (dm-crm issue 012). A message is a scam
// only when it has BOTH a link and impersonation wording (verification badge,
// "activate your account", Meta / Instagram support look-alikes). Either one
// alone is never enough: leads send links all the time.
//
// Spam only affects the inbox view: hidden from the default stream, counted on
// the Spam filter, never in Unread or the nav badge. It never flags a contact
// Kevin or J has personally messaged (lastPersonalSendAt) or one in Personal,
// and never touches a contact with Kevin's sticky override (spamOverride).
// Fixtures: __tests__/os/fixtures/spam-dms.ts (Kevin can add real ones).

const LINK = [
  /\bhttps?:\/\/\S+/i,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/i,
  // A bare domain ("meta-verify.help/badge", "bit.ly/3xYz").
  /\b[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|io|co|me|ly|link|site|online|xyz|info|app|support|help|page|live|top|click|form|forms|cc|tk|ml|ga|gq|cf|icu|shop|store|vip|pro)(\/\S*)?(?=$|[\s),.!?])/i,
];

const IMPERSONATION = [
  // Badges and verification.
  /\b(blue|verification|verified|meta\s+verified)\s*(badge|tick|check(mark)?)\b/i,
  /\bverification\s+(request|process|form|application|program|team)\b/i,
  /\b(eligible|selected|approved)\s+(for|to\s+receive)\s+(the\s+|a\s+)?(verification|verified|blue|meta\s+verified)\b/i,
  /\bactivate\s+(your\s+)?(account|badge|verification|meta\s+verified|profile)\b/i,
  // Account threats.
  /\b(account|page|profile)\s+(will\s+be|has\s+been|is\s+being|is)\s+(permanently\s+)?(disabled|suspended|deleted|restricted|terminated|deactivated|banned|removed)\b/i,
  /\b(copyright|trademark)\s+(infringement|violation|complaint|strike)\b/i,
  /\bviolat(ed|es|ing|ion\s+of)\s+(our\s+|the\s+)?(community\s+guidelines|terms|policy|policies|copyright)\b/i,
  /\b(confirm|verify)\s+(your\s+)?(identity|account\s+ownership|ownership|login\s+details)\b/i,
  /\b(file|submit|fill\s+out)\s+(an?\s+)?appeal\b|\bappeal\s+(form|link|here|now|within)\b/i,
  // Support look-alikes (the brand plus a team word, or a misspelt brand).
  /\b(meta|instagram|facebook|ig)\s*(support|help\s*cent(er|re)|security|integrity|verification|business\s+support|copyright|compliance|policy)(\s+team)?\b/i,
  /\b(m[e3]t[a4]|1nstagram|lnstagram|instagrarn|instaqram|faceb00k)[-_.]?(support|help|verify|verification|business|security)\b/i,
];

export function hasLink(text: string): boolean {
  return LINK.some((r) => r.test(text));
}

export function hasImpersonation(text: string): boolean {
  return IMPERSONATION.some((r) => r.test(text));
}

/** Pure: does this inbound text look like a scam DM? */
export function looksLikeScam(text: string | null | undefined): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  return hasLink(t) && hasImpersonation(t);
}

export interface SpamSubject {
  kind?: string | null;
  lastPersonalSendAt?: Date | string | null;
  spam: boolean;
  spamOverride: boolean | null;
}

/** Contacts the heuristic must never flag. */
export function spamProtected(c: Pick<SpamSubject, "kind" | "lastPersonalSendAt">): boolean {
  return Boolean(c.lastPersonalSendAt) || c.kind === "PERSONAL";
}

/** Should this inbound set the spam flag? Never with an override, never on a
 *  protected contact, and never clears a flag (a scammer's next "hi" doesn't
 *  un-spam them; Kevin's "Not spam" does). */
export function shouldFlagSpam(c: SpamSubject, text: string | null | undefined): boolean {
  if (c.spamOverride !== null) return false;
  if (c.spam) return false;
  if (spamProtected(c)) return false;
  return looksLikeScam(text);
}

/** What the inbox shows: Kevin's override wins, then the flag. */
export function isSpam(c: Pick<SpamSubject, "spam" | "spamOverride">): boolean {
  return c.spamOverride ?? c.spam;
}
