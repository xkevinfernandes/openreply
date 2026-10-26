import { describe, expect, it } from "vitest";
import { commandForKey, isTypingTarget } from "@/components/os/keys";
import { activeNav, BADGED, isActive, osNav, parseSidebarCookie, SIDEBAR_COOKIE, sidebarCookie } from "@/lib/os/nav";

describe("nav", () => {
  it("has the CRM nav in order (Setters = Knowledge bases, same route); Integrations moved into Settings", () => {
    expect(osNav.map((n) => n.label)).toEqual(["Home", "Inbox", "Contacts", "Pipeline", "Follow-ups", "Automations", "Setters", "Resources", "Settings"]);
    expect(osNav.find((n) => n.label === "Setters")?.href).toBe("/os/knowledge");
    expect(osNav.find((n) => n.key === "pipeline")?.href).toBe("/os/pipeline");
    expect(osNav.find((n) => n.key === "resources")?.href).toBe("/os/resources");
    expect(osNav.some((n) => n.href === "/os/integrations")).toBe(false);
    for (const n of osNav) expect(n.icon).toMatch(/^M/);
  });

  it("active item: Home only on /os, Settings also on /os/integrations", () => {
    expect(isActive("/os", "/os")).toBe(true);
    expect(isActive("/os/inbox", "/os")).toBe(false);
    expect(isActive("/os/inbox", "/os/inbox")).toBe(true);
    expect(isActive("/os/inbox/x", "/os/inbox")).toBe(true);
    expect(isActive("/os/inboxes", "/os/inbox")).toBe(false);
    expect(activeNav("/os/integrations")?.key).toBe("settings");
    expect(activeNav("/os/settings")?.key).toBe("settings");
    expect(activeNav("/elsewhere")).toBeNull();
    expect(activeNav("/os/knowledge/abc")?.key).toBe("knowledge");
    expect(activeNav("/os/pipeline")?.key).toBe("pipeline");
    expect(activeNav("/os/resources")?.key).toBe("resources");
  });

  it("only Inbox and Follow-ups carry counts", () => {
    expect([...BADGED].sort()).toEqual(["followups", "inbox"]);
  });
});

describe("rail cookie", () => {
  it("parses: only 'rail' collapses", () => {
    expect(parseSidebarCookie("rail")).toBe("rail");
    expect(parseSidebarCookie("full")).toBe("full");
    expect(parseSidebarCookie(undefined)).toBe("full");
    expect(parseSidebarCookie("RAIL")).toBe("full");
  });

  it("writes a site-wide, year-long cookie", () => {
    const c = sidebarCookie("rail");
    expect(c.startsWith(`${SIDEBAR_COOKIE}=rail;`)).toBe(true);
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=31536000");
  });
});

describe("keyboard → event bus", () => {
  it("J/K/⏎/H/R/E map to commands, modifiers don't", () => {
    const k = (key: string, mods: Partial<KeyboardEvent> = {}) => commandForKey({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });
    expect([k("j"), k("K"), k("Enter"), k("h"), k("r"), k("e")]).toEqual(["next", "prev", "approve", "hold", "regenerate", "focus-draft"]);
    expect(k("k", { metaKey: true })).toBeNull();
    expect(k("x")).toBeNull();
  });

  it("typing targets swallow single-key shortcuts", () => {
    expect(isTypingTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
