"use client";

// Textareas in the inspector grow to fit their copy: no drag handle, no
// inner scrollbar. The panel itself scrolls when a step has a lot of text.

import { forwardRef, useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export const AUTOSIZE_MIN_PX = 60;

type Sizable = { style: { height: string }; scrollHeight: number };

/** Sets the textarea's height to its content (never below minPx). Returns the height. */
export function fitTextarea(el: Sizable | null | undefined, minPx = AUTOSIZE_MIN_PX): number {
  if (!el) return 0;
  // Collapse first so scrollHeight measures the content, not the old box.
  el.style.height = "auto";
  const px = Math.max(minPx, Math.ceil(el.scrollHeight));
  el.style.height = `${px}px`;
  return px;
}

/** Ref + effect: refits on mount, whenever value changes, and on width changes. */
export function useAutosize<T extends HTMLTextAreaElement>(value: unknown, minPx = AUTOSIZE_MIN_PX) {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => {
    fitTextarea(ref.current, minPx);
  }, [value, minPx]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitTextarea(el, minPx);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minPx]);
  return ref;
}

export type AutoTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { minPx?: number };

/** A textarea that sizes itself to its content. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(function AutoTextarea({ minPx = AUTOSIZE_MIN_PX, className, onInput, ...rest }, outer) {
  const ref = useAutosize<HTMLTextAreaElement>(rest.value, minPx);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      ref.current = el;
      if (typeof outer === "function") outer(el);
      else if (outer) outer.current = el;
    },
    [ref, outer]
  );
  return (
    <textarea
      {...rest}
      ref={setRef}
      className={`wf-autosize${className ? ` ${className}` : ""}`}
      style={{ minHeight: minPx, ...rest.style }}
      onInput={(e) => {
        fitTextarea(e.currentTarget, minPx);
        onInput?.(e);
      }}
    />
  );
});
