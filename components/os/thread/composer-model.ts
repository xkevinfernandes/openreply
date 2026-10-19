// The one composer's model (InboxA): J's draft pre-filled as editable
// bubbles, or Kevin's own. Pure, so the bubble editing and keys are tested.
// Owner: S1.

export type ComposerMode = "draft" | "own";

export interface ComposerState {
  mode: ComposerMode;
  bubbles: string[];
}

export function initialComposer(draftBubbles: string[] | null | undefined): ComposerState {
  return draftBubbles?.length ? { mode: "draft", bubbles: [...draftBubbles] } : { mode: "own", bubbles: [""] };
}

/** "Write my own": the draft goes, one empty bubble. */
export function writeOwn(): ComposerState {
  return { mode: "own", bubbles: [""] };
}

export function setBubble(s: ComposerState, i: number, text: string): ComposerState {
  const bubbles = [...s.bubbles];
  bubbles[i] = text;
  return { ...s, bubbles };
}

/** Enter inside a bubble: split it at the caret into two bubbles. */
export function splitBubble(s: ComposerState, i: number, caret: number): ComposerState {
  const b = s.bubbles[i] ?? "";
  const bubbles = [...s.bubbles.slice(0, i), b.slice(0, caret).trimEnd(), b.slice(caret).trimStart(), ...s.bubbles.slice(i + 1)];
  return { ...s, bubbles };
}

/** Backspace at the start of a bubble: join it onto the one before. */
export function mergeBubble(s: ComposerState, i: number): ComposerState {
  if (i <= 0) return s;
  const prev = s.bubbles[i - 1] ?? "";
  const cur = s.bubbles[i] ?? "";
  const joined = prev && cur ? `${prev} ${cur}` : prev || cur;
  return { ...s, bubbles: [...s.bubbles.slice(0, i - 1), joined, ...s.bubbles.slice(i + 1)] };
}

/** A link always goes in its own bubble (attach a lead magnet). */
export function appendLink(s: ComposerState, url: string): ComposerState {
  const kept = s.bubbles.filter((b) => b.trim());
  return { ...s, bubbles: [...kept, url.trim()] };
}

/** What goes out, one entry per message. */
export function outgoing(s: ComposerState): string[] {
  return s.bubbles.map((b) => b.trim()).filter(Boolean);
}

/** The edited text for J's approval path ("a\n\nb"), or null when the draft
 *  goes out untouched. */
export function editedText(s: ComposerState, draftBubbles: string[] | null | undefined): string | null {
  const out = outgoing(s);
  const orig = (draftBubbles ?? []).map((b) => b.trim()).filter(Boolean);
  if (s.mode === "draft" && out.length === orig.length && out.every((b, i) => b === orig[i])) return null;
  return out.join("\n\n");
}

export type BubbleKey = "send" | "split" | "merge" | "blur" | null;

/** Keys while typing in a bubble. ⌘⏎ sends, ⏎ starts a new bubble,
 *  Backspace at the start joins, Esc leaves the draft (then J/K/⏎/H/R work). */
export function bubbleKey(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; isComposing?: boolean },
  at: { caret: number; selectionEmpty: boolean; index: number }
): BubbleKey {
  if (e.isComposing) return null;
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return "send";
  if (e.key === "Enter" && !e.shiftKey) return "split";
  if (e.key === "Backspace" && at.caret === 0 && at.selectionEmpty && at.index > 0) return "merge";
  if (e.key === "Escape") return "blur";
  return null;
}
