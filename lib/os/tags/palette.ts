// The fixed tag palette (no free colour pick): each entry has a light and a
// dark value so a tag reads in both themes. Tag.color stores the key.

export interface TagColor {
  key: string;
  label: string;
  /** Pill background and text, light theme. */
  light: { bg: string; fg: string };
  /** Pill background and text, dark theme. */
  dark: { bg: string; fg: string };
}

export const TAG_COLORS: readonly TagColor[] = [
  { key: "gray", label: "Grey", light: { bg: "#EEEEEC", fg: "#4A4A46" }, dark: { bg: "#34342F", fg: "#D6D6D0" } },
  { key: "red", label: "Red", light: { bg: "#FBE4E1", fg: "#A3271B" }, dark: { bg: "#4A201C", fg: "#F4B4AC" } },
  { key: "orange", label: "Orange", light: { bg: "#FCEAD8", fg: "#9A4A0C" }, dark: { bg: "#4A2E16", fg: "#F6C597" } },
  { key: "yellow", label: "Yellow", light: { bg: "#FBF1C9", fg: "#7A5B00" }, dark: { bg: "#463B14", fg: "#F0D982" } },
  { key: "green", label: "Green", light: { bg: "#E0F2E2", fg: "#21662C" }, dark: { bg: "#1F3D24", fg: "#A6DCAF" } },
  { key: "teal", label: "Teal", light: { bg: "#DCF1EF", fg: "#14615A" }, dark: { bg: "#1A3B39", fg: "#9ED9D2" } },
  { key: "blue", label: "Blue", light: { bg: "#E0EBFB", fg: "#1D4F96" }, dark: { bg: "#1D2F4A", fg: "#A9C6F2" } },
  { key: "purple", label: "Purple", light: { bg: "#ECE4FA", fg: "#5B2E9E" }, dark: { bg: "#33264A", fg: "#CDB6F2" } },
  { key: "pink", label: "Pink", light: { bg: "#FAE3EE", fg: "#9C2462" }, dark: { bg: "#4A2036", fg: "#F2B2D2" } },
];

export const DEFAULT_TAG_COLOR = "gray";

export function tagColor(key: string | null | undefined): TagColor {
  return TAG_COLORS.find((c) => c.key === key) ?? TAG_COLORS[0];
}

export function isTagColor(key: unknown): key is string {
  return typeof key === "string" && TAG_COLORS.some((c) => c.key === key);
}
