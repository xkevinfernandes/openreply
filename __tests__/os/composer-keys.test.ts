import { describe, expect, it } from "vitest";
import {
  appendLink,
  bubbleKey,
  editedText,
  initialComposer,
  mergeBubble,
  outgoing,
  setBubble,
  splitBubble,
  writeOwn,
} from "@/components/os/thread/composer-model";
import { inboxKeyCommand } from "@/components/os/thread/inbox-keys";

const DRAFT = ["ok that's a lot of the same two questions", "what's stopping you from just automating those right now?"];

describe("composer model", () => {
  it("pre-fills J's draft, or one empty bubble", () => {
    expect(initialComposer(DRAFT)).toEqual({ mode: "draft", bubbles: DRAFT });
    expect(initialComposer(null)).toEqual({ mode: "own", bubbles: [""] });
    expect(writeOwn()).toEqual({ mode: "own", bubbles: [""] });
  });

  it("sends the draft untouched as no edit, and an edit as blank-line bubbles", () => {
    const s = initialComposer(DRAFT);
    expect(editedText(s, DRAFT)).toBeNull();
    const edited = setBubble(s, 1, "what's in the way?");
    expect(editedText(edited, DRAFT)).toBe(`${DRAFT[0]}\n\nwhat's in the way?`);
    expect(editedText({ mode: "own", bubbles: ["mine"] }, DRAFT)).toBe("mine");
  });

  it("splits at the caret and joins back", () => {
    const s = { mode: "own" as const, bubbles: ["hello there"] };
    const split = splitBubble(s, 0, 5);
    expect(split.bubbles).toEqual(["hello", "there"]);
    expect(mergeBubble(split, 1).bubbles).toEqual(["hello there"]);
    expect(mergeBubble(split, 0)).toBe(split);
  });

  it("puts a link in its own bubble and drops empty ones", () => {
    const s = appendLink({ mode: "own", bubbles: ["here you go", ""] }, " https://kevinfernandes.me/script-vault ");
    expect(s.bubbles).toEqual(["here you go", "https://kevinfernandes.me/script-vault"]);
    expect(outgoing({ mode: "own", bubbles: [" a ", "", "b"] })).toEqual(["a", "b"]);
  });
});

describe("bubble keys", () => {
  const at = { caret: 3, selectionEmpty: true, index: 1 };
  it("⌘⏎ sends, ⏎ splits, ⇧⏎ is a newline, Esc leaves", () => {
    expect(bubbleKey({ key: "Enter", metaKey: true }, at)).toBe("send");
    expect(bubbleKey({ key: "Enter", ctrlKey: true }, at)).toBe("send");
    expect(bubbleKey({ key: "Enter" }, at)).toBe("split");
    expect(bubbleKey({ key: "Enter", shiftKey: true }, at)).toBeNull();
    expect(bubbleKey({ key: "Escape" }, at)).toBe("blur");
    expect(bubbleKey({ key: "Enter", isComposing: true }, at)).toBeNull();
  });
  it("Backspace at the start joins onto the bubble before", () => {
    expect(bubbleKey({ key: "Backspace" }, { caret: 0, selectionEmpty: true, index: 1 })).toBe("merge");
    expect(bubbleKey({ key: "Backspace" }, { caret: 0, selectionEmpty: true, index: 0 })).toBeNull();
    expect(bubbleKey({ key: "Backspace" }, { caret: 2, selectionEmpty: true, index: 1 })).toBeNull();
  });
});

describe("inbox keys (J/K/⏎/H/R/E)", () => {
  const key = (k: string, target: object = { tagName: "BODY" }, over: object = {}) =>
    inboxKeyCommand({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, repeat: false, target: target as EventTarget, ...over });

  it("maps the six keys", () => {
    expect(["j", "k", "Enter", "h", "r", "e"].map((k) => key(k))).toEqual(["next", "prev", "approve", "hold", "regenerate", "focus-draft"]);
  });
  it("never fires while typing", () => {
    expect(key("h", { tagName: "TEXTAREA" })).toBeNull();
    expect(key("j", { tagName: "DIV", isContentEditable: true })).toBeNull();
  });
  it("leaves Enter to a focused button or link, and ignores held Enter", () => {
    expect(key("Enter", { tagName: "BUTTON" })).toBeNull();
    expect(key("Enter", { tagName: "A" })).toBeNull();
    expect(key("Enter", { tagName: "BODY" }, { repeat: true })).toBeNull();
    expect(key("h", { tagName: "BUTTON" })).toBe("hold");
  });
  it("ignores modified keys", () => {
    expect(key("k", { tagName: "BODY" }, { metaKey: true })).toBeNull();
    expect(key("J", { tagName: "BODY" }, { shiftKey: true })).toBeNull();
  });
});
