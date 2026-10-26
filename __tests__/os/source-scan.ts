// Source scans for the dm-crm "one writer" rules (stage writer, tag writer,
// send stamps). Reads the repo's TypeScript and finds Prisma writes on a model
// whose data names a field, and raw SQL that writes a column. Pure helpers;
// the *-scan.test.ts files say which files may match.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["lib", "app", "components", "worker", "scripts"];
const SKIP = [/^app\/generated\//, /node_modules/];

export function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(ROOT, rel);
    for (const name of readdirSync(abs)) {
      const r = path.join(rel, name);
      if (SKIP.some((re) => re.test(r))) continue;
      const st = statSync(path.join(ROOT, r));
      if (st.isDirectory()) walk(r);
      else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(r);
    }
  };
  for (const d of DIRS) walk(d);
  return out.sort();
}

/** The text between the bracket at `open` and its match (strings skipped). */
export function balanced(src: string, open: number): string {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  let i = open;
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** The object literals written by a Prisma call's argument: data, create,
 *  update (nested too). */
function writtenObjects(arg: string): string[] {
  const out: string[] = [];
  const re = /\b(data|create|update)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arg))) out.push(balanced(arg, m.index + m[0].length - 1));
  return out;
}

/** Does this object literal set `field` (key or shorthand), at any depth? */
function setsField(obj: string, field: string): boolean {
  return new RegExp(`[{,]\\s*(?:"${field}"|${field})\\s*(?::|,|\\})`).test(obj);
}

export interface Hit {
  file: string;
  line: number;
  text: string;
}

/**
 * Prisma writes on `models` (accessor names, e.g. "contact") whose data
 * names one of `fields`, and raw SQL that UPDATEs/INSERTs one of the columns.
 */
export function findWrites(models: string[], fields: string[], files = sourceFiles()): Hit[] {
  return files.flatMap((file) => scanText(file, readFileSync(path.join(ROOT, file), "utf8"), models, fields));
}

/** findWrites on one file's text (tests plant writes with it). */
export function scanText(file: string, src: string, models: string[], fields: string[]): Hit[] {
  const hits: Hit[] = [];
  const call = new RegExp(`\\.(${models.join("|")})\\s*\\.\\s*(update|updateMany|upsert|create|createMany|createManyAndReturn|updateManyAndReturn)\\s*\\(`, "g");
  const raw = /\$(executeRaw|queryRaw|executeRawUnsafe|queryRawUnsafe)\s*(`|\()/g;
  const lineOf = (i: number) => src.slice(0, i).split("\n").length;
  let m: RegExpExecArray | null;
  while ((m = call.exec(src))) {
    const arg = balanced(src, m.index + m[0].length - 1);
    if (writtenObjects(arg).some((o) => fields.some((f) => setsField(o, f)))) hits.push({ file, line: lineOf(m.index), text: src.slice(m.index, m.index + 80).split("\n")[0] });
  }
  while ((m = raw.exec(src))) {
    const start = m.index + m[0].length - 1;
    const body = m[2] === "`" ? src.slice(start, src.indexOf("`", start + 1) + 1) : balanced(src, start);
    if (!/\bUPDATE\s+"|\bINSERT\s+INTO\b/i.test(body)) continue;
    if (fields.some((f) => body.includes(`"${f}"`))) hits.push({ file, line: lineOf(m.index), text: body.slice(0, 80).replace(/\s+/g, " ") });
  }
  return hits;
}
