// Port of DM Setter/scripts/dms/resource_lib.py. The Python module reads one
// global resources.json; here every function takes the catalog rows, so a
// workspace can bring its own (step 4 moves them to the Resource table).

import type { CatalogRow } from "@/lib/os/setter/types";

/** Every string that identifies this resource inside a URL. */
export function fragments(res: CatalogRow): string[] {
  const frags: string[] = [...(res.match ?? [])];
  if (res.resource_url) frags.push(res.resource_url);
  if (res.zernio?.button_url) frags.push(res.zernio.button_url);
  if (res.youtube_id) frags.push(res.youtube_id);
  frags.push(`/${res.slug}`);
  const out: string[] = [];
  for (const f of frags) {
    let clean = String(f)
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    clean = clean.split("#")[0]; // keep the query: "watch?v=<id>" without it matches every video
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/** Resources referenced anywhere in these strings. Matches on URL fragments
 *  only, never the name: a name in conversation is no evidence we sent it. */
export function resolve(texts: string | string[], catalog: CatalogRow[]): CatalogRow[] {
  const list = typeof texts === "string" ? [texts] : texts;
  const blob = list
    .map((t) => t ?? "")
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/g, "");
  return catalog.filter((res) => fragments(res).some((frag) => blob.includes(frag)));
}

/** One resource, as the setter should understand it. */
export function describe(res: CatalogRow): string {
  let out = `- ${res.name ?? res.slug}`;
  if (res.resource_kind) out += ` (${res.resource_kind})`;
  const detail = res.for_setter || res.blurb || "";
  if (detail) out += `\n  ${detail}`;
  if (res.next_step) out += `\n  Natural next step: ${res.next_step}`;
  return out;
}

/** A prompt section, or "" when nothing was referenced (an empty section
 *  invites the model to comment on its own absence). */
export function contextBlock(hits: CatalogRow[]): string {
  if (!hits.length) return "";
  return (
    "What they were sent (resolved from links in this thread — treat this " +
    "as fact, they really did receive it):\n" +
    hits.map(describe).join("\n")
  );
}

export function getRow(slug: string | null | undefined, catalog: CatalogRow[]): CatalogRow | null {
  return (slug && catalog.find((r) => r.slug === slug)) || null;
}

/** Where the resource lives. The Zernio button URL wins: it is click-tracked. */
export function linkOf(res: CatalogRow): string {
  return res.zernio?.button_url || res.resource_url || "";
}

/** The comment → setter path: what they commented for, and what we hold back. */
export function entryBlock(slug: string | null | undefined, catalog: CatalogRow[]): string {
  const row = getRow(slug, catalog);
  if (!row) return "";
  const out = ["THIS PATH (they commented a keyword; OpenReply sent the opener as the private reply):"];
  if (row.for_setter) out.push(row.for_setter);
  const lm = getRow(row.lead_magnet, catalog);
  if (lm) {
    out.push(
      "The lead magnet they asked for (NOT sent yet, it is the value you hand over " +
        `once you know what they need; link: ${linkOf(lm) || "none yet"}):\n` +
        describe(lm)
    );
  }
  return out.join("\n");
}

export interface DmPayload {
  message: string;
  buttons?: { type: "url"; title: string; url: string }[];
}

/** {message, buttons} for one resource DM. Buttons only when there is both a
 *  URL and a label; with a URL but no label the link is inlined. */
export function dmPayload(slug: string, catalog: CatalogRow[]): DmPayload {
  const res = getRow(slug, catalog);
  if (!res) throw new Error(`no resource ${JSON.stringify(slug)} in the catalog`);
  const message = res.dm?.message || res.blurb || res.name || slug;
  const url = linkOf(res);
  const label = res.dm?.button;
  if (url && label) return { message, buttons: [{ type: "url", title: label, url }] };
  if (url) return { message: `${message}\n\n${url}` };
  return { message };
}

/** A raw Zernio message, as far as flattenMessage reads it. */
export interface ZernioMessage {
  id?: string;
  _id?: string;
  message?: string | null;
  direction?: string;
  createdAt?: string;
  timestamp?: string;
  type?: string;
  storyReply?: unknown;
  isStoryMention?: boolean;
  metadata?: { postbackTitle?: string; postbackPayload?: string } | null;
  attachments?: {
    type?: string;
    payload?: {
      generic?: {
        elements?: { title?: string; subtitle?: string; buttons?: { title?: string; url?: string; payload?: string }[] }[];
      };
    };
  }[];
}

/** Zernio message -> one transcript string, attachments included. A button DM
 *  stores its copy in attachments and leaves `message` empty. */
export function flattenMessage(m: ZernioMessage): string {
  const parts: string[] = [];
  const txt = (m.message ?? "").trim();
  if (txt) parts.push(txt);
  for (const a of m.attachments ?? []) {
    const elements = a.payload?.generic?.elements ?? [];
    for (const e of elements) {
      const title = (e.title ?? "").trim();
      if (title) parts.push(title);
      if (e.subtitle) parts.push(e.subtitle.trim());
      for (const b of e.buttons ?? []) parts.push(`[button: ${b.title || "button"} -> ${b.url || b.payload || ""}]`);
    }
    if (!elements.length && a.type && a.type !== "template") parts.push(`[${a.type} attachment]`);
  }
  if (m.metadata?.postbackTitle) parts.push(`[they tapped: ${m.metadata.postbackTitle}]`);
  if (m.storyReply) parts.push("[replying to your story]");
  if (m.isStoryMention) parts.push("[mentioned you in their story]");
  return parts.join("\n");
}
