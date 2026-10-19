"use client";

import { forwardRef } from "react";

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Required: the accessible name (also the tooltip). */
  label: string;
  /** A 16×16 stroke path, or your own svg children. */
  icon?: string;
  children?: React.ReactNode;
  size?: 24 | 28 | 32;
};

/** A square icon-only button with its label as aria-label and title. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, children, size = 28, className, type = "button", ...rest },
  ref
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={`os-icon-btn${className ? ` ${className}` : ""}`} data-size={size} {...rest}>
      {children ?? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d={icon} />
        </svg>
      )}
    </button>
  );
});
