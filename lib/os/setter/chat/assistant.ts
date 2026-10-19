// Setter chat: Kevin says what to change in plain words; the assistant reads
// the setter's docs and recent voice corrections, answers, and proposes
// concrete edits per doc. Nothing is written here: an edit is applied only
// when Kevin presses Apply (lib/os/setter/chat/apply.ts).
//
// Same drafter backends as J's drafts. The fake backend never calls draft():
// it answers deterministically so tests and OS_MOCK click-throughs work.

import type { DrafterSettings } from "@/lib/os/setter/config";
import { draft } from "@/lib/os/setter/drafter";
import { canApply } from "@/lib/os/setter/chat/diff";
import type { CorrectionPair } from "@/lib/os/setter/knowledge/corrections";
import { DOC_FILES, DOC_KEYS, isDocKey, type DocKey, type SetterDocs } from "@/lib/os/setter/knowledge/docs";

export type EditStatus = "proposed" | "applied" | "discarded" | "stale";

export interface ChatEdit {
  id: string;
  doc: DocKey;
  before: string;
  after: string;
  why: string;
  status: EditStatus;
}

export interface ChatTest {
  lead: string[];
  bubbles: string[];
  hold: boolean;
  stage: string | null;
  error?: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  edits?: ChatEdit[];
}

export interface ChatInput {
  setterName: string;
  docs: SetterDocs;
  corrections: CorrectionPair[];
  history: ChatTurn[];
  message: string;
}

export interface ChatAnswer {
  reply: string;
  edits: Omit<ChatEdit, "status">[];
  /** Lead lines to run through the sandbox, when Kevin asked for a test. */
  test: string[] | null;
}

const MAX_EDITS = 4;

export function chatSystem(method: string): string {
  const files = DOC_KEYS.map((k) => `- ${k} = ${DOC_FILES[k].file}: ${DOC_FILES[k].usedWhen}`).join("\n");
  return [
    "You help Kevin tune an Instagram DM setter (the persona who answers his DMs). The setter drafts from a shared setting METHOD plus five Markdown docs.",
    "",
    "THE METHOD (shared by every setter, hidden from the docs: never paste or restate it into a doc; use it to judge what a change should be):",
    method,
    "",
    "THE DOCS (the only things you edit):",
    files,
    "System prompt.md is persona and voice ONLY (who they are, how they text, words used and never used). Business facts go in Business.md, offers in Offers.md (`## Name` then `Label: value` lines: Status, Sold by, Price, Price in DMs, Pitch, Fit), objections in Objections.md (`## objection` then the answer), whole example threads in Examples.md.",
    "",
    "HOW YOU ANSWER: JSON only, no prose around it:",
    '{"reply": "<short plain answer to Kevin, 1-3 sentences>", "edits": [{"doc": "<doc key>", "before": "<exact text copied from the current doc>", "after": "<its replacement>", "why": "<5-12 words>"}], "test": null}',
    "",
    "Rules:",
    "- `before` must be copied EXACTLY from the current doc (a few whole lines). Use \"\" to append `after` at the end of the doc.",
    `- Smallest edits that do the job, at most ${MAX_EDITS}. Keep the doc's format and headings. Never rewrite a whole doc.`,
    "- Never invent facts (prices, proof, links). If something is missing or the ask is unclear, ask in `reply` and propose no edit.",
    "- Respect the setter's character: never pushy, matches their energy, holding is valid.",
    '- When Kevin asks to test or try something, set "test" to 1-3 lead messages to run in the sandbox, e.g. ["hey saw your reel", "I run a small agency"].',
    "- A question with no change needed: answer it, edits [].",
  ].join("\n");
}

export function buildChatPrompt(input: ChatInput): string {
  const docs = DOC_KEYS.map((k) => `<doc key="${k}" file="${DOC_FILES[k].file}">\n${(input.docs[k] ?? "").trim()}\n</doc>`).join("\n\n");
  const corr = input.corrections.length
    ? input.corrections.map((c) => `- J wrote: ${c.wrote || "(n/a)"}\n  Kevin sent: ${c.sent || "(n/a)"}`).join("\n")
    : "(none yet)";
  const hist = input.history
    .slice(-12)
    .map((t) => `${t.role === "user" ? "KEVIN" : "YOU"}: ${t.text}${t.edits?.length ? ` [proposed ${t.edits.length} edit(s): ${t.edits.map((e) => `${DOC_FILES[e.doc].file} ${e.status}`).join(", ")}]` : ""}`)
    .join("\n");
  return [
    `SETTER: ${input.setterName}`,
    "",
    "CURRENT DOCS:",
    docs,
    "",
    "RECENT VOICE CORRECTIONS (what the setter drafted vs what Kevin actually sent):",
    corr,
    "",
    hist ? `CHAT SO FAR:\n${hist}\n` : "",
    `KEVIN NOW: ${input.message.trim()}`,
  ].join("\n");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

let seq = 0;
const editId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

/** The model's JSON, validated against the docs: unknown docs, no-ops and
 *  `before` text that isn't in the doc are dropped. */
export function parseChatReply(obj: unknown, docs: SetterDocs): ChatAnswer {
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const edits: ChatAnswer["edits"] = [];
  for (const raw of Array.isArray(o.edits) ? o.edits : []) {
    const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const doc = e.doc ?? e.file;
    const key = isDocKey(doc) ? doc : DOC_KEYS.find((k) => DOC_FILES[k].file === doc);
    if (!key) continue;
    const before = str(e.before, 40_000);
    const after = str(e.after, 40_000);
    if (before === after || (!before.trim() && !after.trim())) continue;
    if (!canApply(docs[key] ?? "", { before, after })) continue;
    edits.push({ id: editId(), doc: key, before, after, why: str(e.why, 200).trim() });
    if (edits.length >= MAX_EDITS) break;
  }
  const test = Array.isArray(o.test) ? o.test.filter((t): t is string => typeof t === "string" && Boolean(t.trim())).slice(0, 3).map((t) => t.slice(0, 600)) : null;
  let reply = str(o.reply, 4000).trim();
  if (!reply) reply = edits.length ? "Here's the change." : "Done.";
  return { reply, edits, test: test?.length ? test : null };
}

// ---------------------------------------------------------------- fake
const TEST_ASK = /\b(test|try)\b/i;

/** Deterministic answers for tests and sample mode:
 *  "add the X offer"         → a new `## X` section in Offers.md (Status: draft)
 *  "test …" / "try …"        → a sandbox run, no edit
 *  anything else              → a line under `## Voice` in System prompt.md */
export function fakeChat(input: ChatInput): ChatAnswer {
  const msg = input.message.trim();
  if (TEST_ASK.test(msg) && !/\badd\b|\bstop\b|\bnever\b/i.test(msg)) {
    return { reply: "Running it in the sandbox (sample).", edits: [], test: ["hey saw your post", "I run a small agency, stuck on leads"] };
  }
  const offer = /\badd (?:the |a |an )?(.+?) offer\b/i.exec(msg);
  if (offer) {
    const name = offer[1].trim().replace(/^./, (c) => c.toUpperCase());
    return {
      reply: `Added ${name} to Offers.md as a draft. Set its price and status before J invites to it.`,
      edits: [{ id: editId(), doc: "offers", before: "", after: `## ${name}\n\nStatus: draft\nSold by: call`, why: "New offer, closed until you open it" }],
      test: null,
    };
  }
  const body = input.docs.system_prompt ?? "";
  const rule = `- ${msg.replace(/^please\s+/i, "").replace(/\.$/, "")}.`;
  const voice = /^##[ \t]+Voice[ \t]*\n/m.exec(body);
  const edit = voice
    ? { before: voice[0], after: `${voice[0]}\n${rule}\n` }
    : { before: "", after: `## Voice\n\n${rule}` };
  return { reply: "Added it to the voice rules in System prompt.md.", edits: [{ id: editId(), doc: "system_prompt", ...edit, why: "Your rule, in J's voice section" }], test: null };
}

// ---------------------------------------------------------------- run
export async function runChat(input: ChatInput, settings: DrafterSettings, method: string): Promise<ChatAnswer> {
  if (settings.backend === "fake") return fakeChat(input);
  const s: DrafterSettings = {
    ...settings,
    max_tokens: { ...settings.max_tokens, setter_chat: settings.max_tokens.setter_chat ?? 8000 },
    models: { ...settings.models, setter_chat: settings.models.setter_chat ?? settings.models.draft },
  };
  const { obj } = await draft({ system: chatSystem(method), prompt: buildChatPrompt(input), job: "setter_chat", settings: s });
  return parseChatReply(obj, input.docs);
}
