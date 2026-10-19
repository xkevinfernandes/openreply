"use client";

// The rich (TipTap) view of a setter doc. Storage stays Markdown: the body is
// parsed into TipTap JSON and serialized back on every change (rich-md.ts).
// Loaded with next/dynamic (ssr:false) from doc-editor.tsx.

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNodeType } from "@tiptap/pm/model";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import { GAP_TYPES, docToMarkdown, markdownToDoc, type PMNode } from "@/lib/os/setter/knowledge/rich-md";

/** Blank lines before a block, kept so the Markdown comes back as it was. */
const MdGap = Extension.create({
  name: "mdGap",
  addGlobalAttributes() {
    return [
      {
        types: GAP_TYPES,
        attributes: {
          mdGap: { default: null, keepOnSplit: false, rendered: false },
        },
      },
    ];
  },
});

const LABEL = /^([A-Z][A-Za-z' ]{0,23}?):\s/;
const labelKey = new PluginKey("kbLabels");

function labelDecos(doc: PMNodeType): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return node.isBlock;
    let lineStart = true;
    node.forEach((child, offset) => {
      if (child.type.name === "hardBreak") {
        lineStart = true;
        return;
      }
      if (lineStart && child.isText) {
        const m = LABEL.exec(child.text ?? "");
        if (m) {
          const from = pos + 1 + offset;
          decos.push(Decoration.inline(from, from + m[1].length + 1, { class: "kb-rich-label" }));
        }
      }
      lineStart = false;
    });
    return false;
  });
  return DecorationSet.create(doc, decos);
}

/** `Label: value` lines get a quiet label, like the old read view. */
const Labels = Extension.create({
  name: "kbLabels",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: labelKey,
        state: {
          init: (_, state) => labelDecos(state.doc),
          apply: (tr, old) => (tr.docChanged ? labelDecos(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return labelKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

interface RichDocProps {
  markdown: string;
  label: string;
  onChange: (md: string) => void;
  onBlur?: () => void;
  onEditor?: (editor: Editor | null) => void;
}

export default function RichDoc({ markdown, label, onChange, onBlur, onEditor }: RichDocProps) {
  const emitted = useRef(markdown);
  const cb = useRef({ onChange, onBlur });
  useEffect(() => {
    cb.current = { onChange, onBlur };
  });

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
      }),
      MdGap,
      Labels,
    ],
    content: markdownToDoc(markdown) as never,
    editorProps: { attributes: { class: "kb-doc kb-rich", "aria-label": label, spellcheck: "true" } },
    onUpdate: ({ editor: ed }) => {
      const md = docToMarkdown(ed.getJSON() as PMNode);
      if (md === emitted.current) return;
      emitted.current = md;
      cb.current.onChange(md);
    },
    onBlur: () => cb.current.onBlur?.(),
  });

  // A new body from outside (restore, a remount after a save elsewhere).
  useEffect(() => {
    if (!editor || markdown === emitted.current) return;
    emitted.current = markdown;
    editor.commands.setContent(markdownToDoc(markdown) as never, { emitUpdate: false });
  }, [editor, markdown]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor, onEditor]);

  return <EditorContent editor={editor} className="kb-richwrap" />;
}
