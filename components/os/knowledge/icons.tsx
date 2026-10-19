// The Knowledge bases icons, from the SetterA / Resources boards (16px grid, 1.4 stroke).

const PATHS = {
  file: "M4 1.8h5l3 3v9.4H4V1.8ZM9 1.8v3h3",
  funnel: "M2 4h12M4 8h8M6 12h4",
  gift: "M3 5.5h10v8H3v-8ZM5.5 5.5V3.5h5v2",
  mic: "M6 2.5h4v6.5a2 2 0 0 1-4 0V2.5ZM3.5 8.5a4.5 4.5 0 0 0 9 0M8 13v1.5",
  calendar: "M2.5 3.5h11v10h-11v-10ZM2.5 6.5h11M5.5 2v3M10.5 2v3",
  table: "M2.5 3.5h11v9h-11v-9ZM2.5 6.5h11M6 6.5v6",
  clock: "M8 13.8A5.8 5.8 0 1 0 8 2.2a5.8 5.8 0 0 0 0 11.6ZM8 4.8V8l2.2 1.4",
  flask: "M6 2h4M6.5 2v4L3 13.5h10L9.5 6V2",
  pencil: "m10.5 2.5 3 3L6 13H3v-3l7.5-7.5Z",
  bolt: "M9 1.8 3.5 9H8l-1 5.2L12.5 7H8l1-5.2Z",
  user: "M8 8a2.8 2.8 0 1 0 0-5.6A2.8 2.8 0 0 0 8 8ZM2.8 13.8c.6-2.6 2.7-4 5.2-4s4.6 1.4 5.2 4",
  chevron: "m6 3.5 4.5 4.5L6 12.5",
  plus: "M8 3v10M3 8h10",
  download: "M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10",
  play: "M5 3v10l8-5-8-5Z",
  list: "M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01",
  link: "M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.7.7M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.7-.7",
  grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  video: "M2.5 4h8v8h-8V4ZM10.5 7l3-2v6l-3-2",
} as const;

export type KbIconName = keyof typeof PATHS;

export function KbIcon({ name, size = 14 }: { name: KbIconName; size?: number }) {
  const fat = name === "grip" || name === "more";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={fat ? 2.2 : 1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
