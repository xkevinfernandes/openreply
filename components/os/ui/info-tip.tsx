"use client";

import { useId } from "react";

/** The (i): explanations live here, never as visible paragraphs. */
export function InfoTip({ children, label = "More info" }: { children: React.ReactNode; label?: string }) {
  const id = useId();
  return (
    <span className="os-infotip">
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
