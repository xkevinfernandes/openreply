// 16px stroke icons from the Workflow boards (stroke 1.4, currentColor).

import type { StepType } from "@/lib/os/workflows/graph";

const P = {
  trigger: "M9 2 4 9h4l-1 5 5-7H8l1-5Z",
  message: "M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
  wait: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4",
  ask: "M2.5 4.5h11v7h-11zM4.8 8h4.4M11 7v2",
  condition: "M4 2.5v11M4 6.5c0 2 1.5 3 3.5 3H12M10 7.5l2 2-2 2",
  action: "M9 1.8 3.5 9H8l-1 5.2L12.5 7H8l1-5.2Z",
  randomizer: "M2 4.5h2.5c3 0 4 7 7 7H14M2 11.5h2.5c1.2 0 2-1 2.8-2.4M9.6 6c.6-.9 1.2-1.5 2-1.5H14M12.3 2.8 14 4.5l-1.7 1.7M12.3 9.8 14 11.5l-1.7 1.7",
  setter: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3.5 13.5c.4-2.4 2.2-3.8 4.5-3.8s4.1 1.4 4.5 3.8",
  goto: "M2.5 8h8.5M8 4.5 11.5 8 8 11.5M13.5 3v10",
  end: "M4.5 4.5h7v7h-7z",
  // Trigger kinds
  comment: "M2.5 3.5h11v7.5H7.5l-3 2.5V11h-2V3.5Z",
  story_reply: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6Z",
  dm: "M14 2 7 9M14 2 9.5 14 7 9 2 6.5 14 2Z",
  // UI
  plus: "M8 3.5v9M3.5 8h9",
  close: "M4 4l8 8M12 4l-8 8",
  back: "M10 3.5 5.5 8 10 12.5",
  chevron: "M6 3.5 10.5 8 6 12.5",
  arrow: "M3 8h10M9.5 4.5 13 8l-3.5 3.5",
  undo: "M5 6.5H10a3 3 0 0 1 0 6H7M5 6.5 7.5 4M5 6.5 7.5 9",
  redo: "M11 6.5H6a3 3 0 0 0 0 6h3M11 6.5 8.5 4M11 6.5 8.5 9",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5",
  sync: "M3 6.5a5 5 0 0 1 9-1.5M13 9.5a5 5 0 0 1-9 1.5M12 2.5v2.5H9.5M4 13.5V11h2.5",
  link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6",
  image: "M2.5 3h11v10h-11zM2.5 10.5l3-3 3 3 2-2 3 3",
  doc: "M4 1.8h5.5L12.5 5v9.2H4V1.8ZM9.5 1.8V5h3",
  phone: "M5 1.8h6v12.4H5zM7.2 12h1.6",
  settings: "M2.5 4.5h7M12 4.5h1.5M2.5 11.5h2M7 11.5h6.5M10.5 3v3M5.5 10v3",
  tests: "M5.5 2.5v4l-3 6.5h11l-3-6.5v-4M4.5 2.5h7",
  stats: "M3 13V8M6.5 13V4M10 13V9.5M13.5 13V6",
  up: "M4 10l4-4 4 4",
  down: "M4 6l4 4 4-4",
  tag: "M2.5 2.5h5l6 6-5 5-6-6v-5ZM5.2 5.2v.1",
  resume: "M5 3.5v9l7-4.5-7-4.5Z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  grip: "M6 4v.1M10 4v.1M6 8v.1M10 8v.1M6 12v.1M10 12v.1",
} as const;

export type WfIconName = keyof typeof P;

export function WfIcon({ name, size = 16, className }: { name: WfIconName | StepType; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ flex: `0 0 ${size}px` }}
    >
      <path d={P[name as WfIconName]} strokeDasharray={name === "story_reply" ? "2.4 1.6" : undefined} />
    </svg>
  );
}
