"use client";

import { forwardRef } from "react";
import { IconButton as CpIconButton } from "@claudepreneur/brand/react";

type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** Required: the accessible name (also the tooltip). */
  label: string;
  /** A 16×16 stroke path, or your own svg children. */
  icon?: string;
  children?: React.ReactNode;
  size?: 24 | 28 | 32;
};

/** An icon-only button: the shared IconButton (@claudepreneur/brand), 32px. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, children, size: _size, ...rest }, ref) {
  void _size;
  return (
    <CpIconButton
      ref={ref}
      label={label}
      size="sm"
      icon={
        children ?? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d={icon} />
          </svg>
        )
      }
      {...rest}
    />
  );
});
