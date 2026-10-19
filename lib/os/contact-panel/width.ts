// The contact panel's width, shared by the Inbox and Contacts so the panel is
// the same in both. Dragging its left edge changes it; the value lives in a
// cookie (read by the layout, so the first paint is right) and localStorage.

export const PANEL_WIDTH_COOKIE = "os_panel_w";
export const PANEL_WIDTH_KEY = "os.panelWidth";
export const PANEL_MIN = 320;
export const PANEL_MAX = 720;
export const PANEL_DEFAULT = 380;
/** Arrow keys move it this much; Shift+arrow four times as much. */
export const PANEL_STEP = 16;

export function clampPanelWidth(w: number): number {
  if (!Number.isFinite(w)) return PANEL_DEFAULT;
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, w)));
}

export function parsePanelWidth(raw: string | null | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? clampPanelWidth(n) : PANEL_DEFAULT;
}

export function panelWidthCookie(w: number): string {
  return `${PANEL_WIDTH_COOKIE}=${clampPanelWidth(w)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
