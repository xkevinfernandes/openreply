// Setter chat edits: apply one proposed edit to a doc, and the line diff the
// panel shows for it. Pure.

export interface DocEdit {
  /** Exact text in the doc to replace. "" appends `after` at the end. */
  before: string;
  after: string;
}

export interface DiffLine {
  op: "same" | "del" | "add";
  text: string;
}

const norm = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

/** The doc with the edit applied, or null when `before` isn't in it any more. */
export function applyEdit(body: string, edit: DocEdit): string | null {
  const after = edit.after.replace(/\r\n/g, "\n");
  if (!edit.before.trim()) {
    const head = body.replace(/\s+$/, "");
    return `${head ? `${head}\n\n` : ""}${after.trim()}\n`;
  }
  const before = edit.before.replace(/\r\n/g, "\n");
  const at = body.indexOf(before);
  if (at !== -1) return body.slice(0, at) + after + body.slice(at + before.length);
  // The model often drops trailing spaces or the last newline: match line by line.
  const want = norm(before).split("\n");
  const lines = body.split("\n");
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (want.every((w, j) => lines[i + j].trimEnd() === w)) {
      return [...lines.slice(0, i), ...after.replace(/\n$/, "").split("\n"), ...lines.slice(i + want.length)].join("\n");
    }
  }
  return null;
}

/** Is `before` (still) in the doc? */
export function canApply(body: string, edit: DocEdit): boolean {
  return applyEdit(body, edit) !== null;
}

/** Line diff (LCS) of before → after, for the panel. */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a ? a.replace(/\n$/, "").split("\n") : [];
  const y = b ? b.replace(/\n$/, "").split("\n") : [];
  const n = x.length;
  const m = y.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ op: "same", text: x[i] });
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "del", text: x[i++] });
    else out.push({ op: "add", text: y[j++] });
  }
  while (i < n) out.push({ op: "del", text: x[i++] });
  while (j < m) out.push({ op: "add", text: y[j++] });
  return out;
}
