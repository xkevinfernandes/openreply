"use client";

import { useId, useRef } from "react";

/** How close (px) to a viewport edge before the tip hangs inward. */
const EDGE = 150;

/** The (i): explanations live here, never as visible paragraphs. */
export function InfoTip({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  // Centred by default; near the left or right edge it hangs inward so it
  // never runs off screen.
  function place() {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2;
    if (window.innerWidth - mid < EDGE) el.dataset.align = "end";
    else if (mid < EDGE) el.dataset.align = "start";
    else delete el.dataset.align;
  }

  return (
    <span className="os-infotip" ref={ref} onPointerEnter={place} onFocus={place}>
      <button type="button" className="os-infotip-btn" aria-label={label} aria-describedby={id}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7.2v3.6M8 5.2v.1" />
        </svg>
      </button>
      <span role="tooltip" id={id} className="os-infotip-body">
        {children}
      </span>
    </span>
  );
}
