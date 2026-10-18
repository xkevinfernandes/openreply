// How a person reads in the Inbox. Hidden or restricted Instagram profiles
// come through without a username: show their name, else "Instagram user",
// never "@unknown".

export function threadName(username: string | null | undefined, fullName?: string | null): string {
  if (username) return `@${username}`;
  return fullName?.trim() || "Instagram user";
}

/** What the avatar's initial is drawn from. */
export function initialSource(username: string | null | undefined, fullName?: string | null): string | null {
  return username || fullName?.trim() || null;
}
