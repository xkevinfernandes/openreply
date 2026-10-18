// OpenReply pages we reuse inside the DM OS navigate to their own routes
// (the old dashboard). This maps those hrefs to ours, so the OS never hands
// you back to the old dashboard. Anything unmapped passes through.

const MAP: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^\/campaigns\/?$/, () => "/os/automations"],
  [/^\/campaigns\/new\/?$/, () => "/os/automations/new"],
  [/^\/campaigns\/([^/?#]+)(?:\/edit)?\/?$/, (m) => `/os/automations/${m[1]}`],
  [/^\/automations\/?$/, () => "/os/automations"],
  [/^\/settings\/?$/, () => "/os/settings"],
  [/^\/logs\/?$/, () => "/os/settings?tab=logs"],
  [/^\/diagnostics\/?$/, () => "/os/settings?tab=diagnostics"],
];

export function osHrefForUpstream(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const rest = cut < 0 ? "" : href.slice(cut);
  for (const [re, to] of MAP) {
    const m = path.match(re);
    if (m) {
      const target = to(m);
      // Keep the caller's query/hash unless the target already carries a query.
      return target.includes("?") ? target : target + rest;
    }
  }
  return href;
}
