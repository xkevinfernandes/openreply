// Markdown <-> TipTap (ProseMirror JSON) for the setter docs. Pure, no
// dependencies, so the round trip is tested on the real docs.
//
// Lossless by design for what the docs use: each source line stays a line
// (hard breaks, so `Label: value` lines never merge), blank lines between
// blocks are kept in `mdGap`, and text is never escaped or reflowed.

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
}

/** Block types that carry `mdGap` (blank lines before them). */
export const GAP_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "horizontalRule"];

// ---------------------------------------------------------------- inline
type Hit = { start: number; end: number; inner?: string; mark?: PMMark; code?: string; url?: string };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

function firstHit(s: string): Hit | null {
  const cands: Hit[] = [];
  let m: RegExpExecArray | null;
  if ((m = /`([^`]+)`/.exec(s))) cands.push({ start: m.index, end: m.index + m[0].length, code: m[1] });
  const lx = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  while ((m = lx.exec(s))) {
    if (SAFE_HREF.test(m[2])) {
      cands.push({ start: m.index, end: m.index + m[0].length, inner: m[1], mark: { type: "link", attrs: { href: m[2] } } });
      break;
    }
  }
  if ((m = /\*\*([^*]+?)\*\*/.exec(s))) cands.push({ start: m.index, end: m.index + m[0].length, inner: m[1], mark: { type: "bold" } });
  if ((m = /~~([^~]+)~~/.exec(s))) cands.push({ start: m.index, end: m.index + m[0].length, inner: m[1], mark: { type: "strike" } });
  if ((m = /(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/.exec(s))) {
    const st = m.index + m[1].length;
    cands.push({ start: st, end: m.index + m[0].length, inner: m[2], mark: { type: "italic" } });
  }
  if ((m = /(^|[\s(])(https?:\/\/[^\s<)]+)/.exec(s))) {
    const st = m.index + m[1].length;
    cands.push({ start: st, end: st + m[2].length, url: m[2] });
  }
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.start < a.start ? b : a));
}

function textNodes(text: string, marks: PMMark[]): PMNode[] {
  const out: PMNode[] = [];
  text.split("\n").forEach((part, i) => {
    if (i > 0) out.push(marks.length ? { type: "hardBreak", marks } : { type: "hardBreak" });
    if (part) out.push(marks.length ? { type: "text", text: part, marks } : { type: "text", text: part });
  });
  return out;
}

function parseInlineInto(s: string, marks: PMMark[], out: PMNode[]) {
  let rest = s;
  while (rest) {
    const hit = firstHit(rest);
    if (!hit) {
      out.push(...textNodes(rest, marks));
      return;
    }
    if (hit.start > 0) out.push(...textNodes(rest.slice(0, hit.start), marks));
    if (hit.code !== undefined) out.push(...textNodes(hit.code, [...marks, { type: "code" }]));
    else if (hit.url !== undefined) out.push(...textNodes(hit.url, [...marks, { type: "link", attrs: { href: hit.url } }]));
    else if (marks.some((x) => x.type === hit.mark!.type)) out.push(...textNodes(rest.slice(hit.start, hit.end), marks));
    else parseInlineInto(hit.inner!, [...marks, hit.mark!], out);
    rest = rest.slice(hit.end);
  }
}

/** Inline Markdown (lines joined by "\n") → text + hardBreak nodes. */
export function parseInline(s: string): PMNode[] {
  const out: PMNode[] = [];
  parseInlineInto(s, [], out);
  return out;
}

const ORDER = ["bold", "italic", "strike", "link", "code"] as const;
const WRAP: Record<string, string> = { bold: "**", italic: "*", strike: "~~" };

function markKey(n: PMNode, type: string): string {
  const m = n.marks?.find((x) => x.type === type);
  if (!m) return "";
  return type === "link" ? `link:${String(m.attrs?.href ?? "")}` : type;
}

function serInlineAt(nodes: PMNode[], d: number): string {
  if (d === ORDER.length) return nodes.map((n) => (n.type === "hardBreak" ? "\n" : (n.text ?? ""))).join("");
  const type = ORDER[d];
  let out = "";
  let i = 0;
  while (i < nodes.length) {
    const key = markKey(nodes[i], type);
    let j = i + 1;
    while (j < nodes.length && markKey(nodes[j], type) === key) j++;
    const inner = serInlineAt(nodes.slice(i, j), d + 1);
    if (!key || !inner) out += inner;
    else if (type === "code") out += "`" + inner + "`";
    else if (type === "link") {
      const href = key.slice(5);
      out += inner === href || !href ? inner : `[${inner}](${href})`;
    } else {
      const lead = /^\s*/.exec(inner)![0];
      const trail = /\s*$/.exec(inner.slice(lead.length))![0];
      const core = inner.slice(lead.length, inner.length - trail.length);
      out += core ? lead + WRAP[type] + core + WRAP[type] + trail : inner;
    }
    i = j;
  }
  return out;
}

export function serializeInline(nodes: PMNode[] | undefined): string {
  return serInlineAt(nodes ?? [], 0);
}

// ---------------------------------------------------------------- blocks
const HEADING = /^(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^\s*```(.*)$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^(\s*)([-*+]|\d+[.)])(?:[ \t]+(.*))?$/;

const indentOf = (s: string) => /^\s*/.exec(s.replace(/\t/g, "    "))![0].length;
const isStart = (ln: string) => HEADING.test(ln) || HR.test(ln) || FENCE.test(ln) || QUOTE.test(ln) || ITEM.test(ln);

function withGap(n: PMNode, gap: number): PMNode {
  return { ...n, attrs: { ...(n.attrs ?? {}), mdGap: gap } };
}

function paragraph(text: string): PMNode {
  const content = parseInline(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

function parseList(lines: string[], start: number): { node: PMNode; next: number } {
  const first = ITEM.exec(lines[start])!;
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const items: PMNode[] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = base + m[2].length + 1;
    const text: string[] = [m[3] ?? ""];
    const children: PMNode[] = [];
    i++;
    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) break;
      const sub = ITEM.exec(ln);
      if (sub && indentOf(sub[1]) > base) {
        const r = parseList(lines, i);
        children.push(withGap(r.node, 0));
        i = r.next;
        continue;
      }
      if (isStart(ln) || children.length) break;
      // A continuation line: drop the item's indent, keep any extra.
      const strip = Math.min(indentOf(ln), contentIndent);
      text.push(ln.replace(/\t/g, "    ").slice(strip));
      i++;
    }
    items.push({ type: "listItem", content: [paragraph(text.join("\n")), ...children] });
  }
  const node: PMNode = ordered
    ? { type: "orderedList", attrs: { start: Number(/\d+/.exec(first[2])![0]) }, content: items }
    : { type: "bulletList", content: items };
  return { node, next: i };
}

function parseBlocks(lines: string[]): PMNode[] {
  const out: PMNode[] = [];
  let blank = 0;
  let i = 0;
  const push = (n: PMNode) => {
    out.push(withGap(n, out.length ? blank : 0));
    blank = 0;
  };
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim()) {
      blank++;
      i++;
      continue;
    }
    const fence = FENCE.exec(ln);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const text = body.join("\n");
      push({ type: "codeBlock", attrs: { language: fence[1].trim() || null }, ...(text ? { content: [{ type: "text", text }] } : {}) });
      continue;
    }
    const h = HEADING.exec(ln);
    if (h) {
      const content = parseInline(h[2] ?? "");
      push({ type: "heading", attrs: { level: h[1].length }, ...(content.length ? { content } : {}) });
      i++;
      continue;
    }
    if (HR.test(ln)) {
      push({ type: "horizontalRule" });
      i++;
      continue;
    }
    if (QUOTE.test(ln)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(lines[i++].replace(/^ {0,3}> ?/, ""));
      const content = parseBlocks(inner);
      push({ type: "blockquote", content: content.length ? content : [{ type: "paragraph" }] });
      continue;
    }
    if (ITEM.test(ln)) {
      const r = parseList(lines, i);
      push(r.node);
      i = r.next;
      continue;
    }
    const para: string[] = [ln];
    i++;
    while (i < lines.length && lines[i].trim() && !isStart(lines[i])) para.push(lines[i++]);
    push(paragraph(para.join("\n")));
  }
  return out;
}

/** Markdown → a TipTap doc (JSON). */
export function markdownToDoc(md: string): PMNode {
  const content = parseBlocks((md ?? "").replace(/\r\n?/g, "\n").split("\n"));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

function serBlocks(nodes: PMNode[] | undefined, defaultGap: number, keepFirstEmpty = false): string {
  let out = "";
  let n = 0;
  (nodes ?? []).forEach((node, idx) => {
    const isEmptyPara = node.type === "paragraph" && !node.content?.length;
    if (isEmptyPara && !(keepFirstEmpty && idx === 0)) return;
    const gap = node.attrs?.mdGap;
    if (n > 0) out += "\n".repeat((typeof gap === "number" ? gap : defaultGap) + 1);
    out += serBlock(node);
    n++;
  });
  return out;
}

function serBlock(node: PMNode): string {
  switch (node.type) {
    case "paragraph":
      return serializeInline(node.content);
    case "heading": {
      const t = serializeInline(node.content).replace(/\n/g, " ").trim();
      return "#".repeat(Number(node.attrs?.level ?? 2)) + (t ? ` ${t}` : "");
    }
    case "bulletList":
    case "orderedList": {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, k) => {
          const marker = node.type === "bulletList" ? "-" : `${start + k}.`;
          const pad = " ".repeat(marker.length + 1);
          const lines = serBlocks(item.content, 0, true).split("\n");
          const head = lines[0] ? `${marker} ${lines[0]}` : marker;
          return [head, ...lines.slice(1).map((l) => (l ? pad + l : l))].join("\n");
        })
        .join("\n");
    }
    case "blockquote":
      return serBlocks(node.content, 1)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    case "codeBlock": {
      const lang = node.attrs?.language ? String(node.attrs.language) : "";
      return "```" + lang + "\n" + (node.content ?? []).map((c) => c.text ?? "").join("") + "\n```";
    }
    case "horizontalRule":
      return "---";
    default:
      return node.content ? serBlocks(node.content, 1) : (node.text ?? "");
  }
}

/** A TipTap doc (JSON) → Markdown. */
export function docToMarkdown(doc: PMNode): string {
  const md = serBlocks(doc.content, 1);
  return md ? md + "\n" : "";
}

export function roundTrip(md: string): string {
  return docToMarkdown(markdownToDoc(md));
}
