// A tiny Markdown renderer for the doc editor (no dependencies). The editor
// edits one block at a time, so the text outside the block being edited stays
// byte-for-byte what was saved: splitBlocks/joinBlocks are lossless.
//
// Everything is escaped first; links are http(s)/mailto only.

export interface MdBlock {
  text: string;
  /** The blank lines after it, kept as they were. */
  sep: string;
}

/** Blocks are separated by blank lines, except inside ``` fences. */
export function splitBlocks(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  const lead = /^\s*/.exec(src)?.[0] ?? "";
  if (lead) out.push({ text: "", sep: lead });
  const lines = src.slice(lead.length).split("\n");
  let cur: string[] = [];
  let sep: string[] = [];
  let fence = false;
  const flush = () => {
    if (cur.length) out.push({ text: cur.join("\n"), sep: "" });
    cur = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\s*```/.test(ln)) fence = !fence;
    if (!fence && !ln.trim() && cur.length) {
      sep.push(ln);
      continue;
    }
    if (sep.length) {
      flush();
      out[out.length - 1].sep = "\n" + sep.join("\n") + "\n";
      sep = [];
    }
    cur.push(ln);
  }
  if (cur.length) flush();
  if (sep.length && out.length) out[out.length - 1].sep = "\n" + sep.join("\n");
  return out;
}

export function joinBlocks(blocks: MdBlock[]): string {
  return blocks.map((b) => b.text + b.sep).join("");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : /^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(u) ? `https://${u}` : null;
}

/** Inline: `code`, **bold**, *em*, ~~strike~~, [text](url), bare URLs. */
export function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, "&"));
    return href ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${text}</a>` : m;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre: string, url: string) => `${pre}<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>").replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${esc(codes[Number(i)])}</code>`);
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const DL = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Z][A-Za-z' ]{0,23}?)(?:\*\*)?\s*:(?:\*\*)?\s+(\S.*)$/;

function list(lines: string[]): string {
  // Nested by indentation: a deeper item opens a child list.
  let html = "";
  const stack: { indent: number; tag: string }[] = [];
  for (const ln of lines) {
    const m = LIST.exec(ln);
    if (!m) {
      html += ` ${inline(ln.trim())}`;
      continue;
    }
    const indent = m[1].replace(/\t/g, "  ").length;
    const tag = /\d/.test(m[2]) ? "ol" : "ul";
    while (stack.length && indent < stack[stack.length - 1].indent) html += `</li></${stack.pop()!.tag}>`;
    if (!stack.length || indent > stack[stack.length - 1].indent) {
      stack.push({ indent, tag });
      html += `<${tag}><li>`;
    } else html += "</li><li>";
    html += inline(m[3]);
  }
  while (stack.length) html += `</li></${stack.pop()!.tag}>`;
  return html;
}

/** One block → HTML. */
export function renderBlock(md: string): string {
  const t = md.replace(/\s+$/, "");
  if (!t.trim()) return "";
  const lines = t.split("\n");
  const h = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
  if (h && lines.length === 1) return `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`;
  if (h) return renderBlock(lines[0]) + renderBlock(lines.slice(1).join("\n"));
  if (/^\s*```/.test(lines[0])) return `<pre><code>${esc(lines.slice(1, /^\s*```/.test(lines[lines.length - 1]) && lines.length > 1 ? -1 : undefined).join("\n"))}</code></pre>`;
  if (/^\s*(-{3,}|\*{3,})\s*$/.test(t)) return "<hr>";
  if (lines.every((l) => /^\s*>/.test(l))) return `<blockquote>${renderBlock(lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n"))}</blockquote>`;
  if (lines.every((l) => /^\s*\|/.test(l))) return `<pre class="md-table">${esc(t)}</pre>`;
  if (LIST.test(lines[0])) return list(lines);
  if (lines.length > 1 && lines.every((l) => DL.test(l))) {
    return `<dl>${lines.map((l) => DL.exec(l)!).map((m) => `<dt>${esc(m[1])}</dt><dd>${inline(m[2])}</dd>`).join("")}</dl>`;
  }
  return `<p>${lines.map(inline).join("<br>")}</p>`;
}

export function renderMarkdown(md: string): string {
  return splitBlocks(md)
    .map((b) => renderBlock(b.text))
    .join("");
}

// ---------------------------------------------------------------- toolbar
export interface Edit {
  text: string;
  selStart: number;
  selEnd: number;
}

/** H: toggle `## ` on the line(s); B: wrap in **; list: toggle `- `; link: [text](url). */
export function applyFormat(kind: "heading" | "bold" | "list" | "link", e: Edit): Edit {
  const { text, selStart, selEnd } = e;
  if (kind === "bold" || kind === "link") {
    const sel = text.slice(selStart, selEnd) || (kind === "bold" ? "bold" : "link");
    const wrapped = kind === "bold" ? `**${sel}**` : `[${sel}](https://)`;
    const next = text.slice(0, selStart) + wrapped + text.slice(selEnd);
    const start = selStart + (kind === "bold" ? 2 : wrapped.length - 9);
    return { text: next, selStart: start, selEnd: kind === "bold" ? start + sel.length : start + 8 };
  }
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const nl = text.indexOf("\n", selEnd);
  const lineEnd = nl === -1 ? text.length : nl;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const rx = kind === "heading" ? /^#{1,6}\s+/ : /^\s*[-*+]\s+/;
  const prefix = kind === "heading" ? "## " : "- ";
  const on = lines.every((l) => rx.test(l));
  const changed = lines.map((l) => (on ? l.replace(rx, "") : prefix + l.replace(kind === "heading" ? /^#{1,6}\s+/ : /^/, ""))).join("\n");
  const next = text.slice(0, lineStart) + changed + text.slice(lineEnd);
  return { text: next, selStart: lineStart, selEnd: lineStart + changed.length };
}
