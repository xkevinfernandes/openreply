import { describe, expect, it } from "vitest";
import { cleanBaseUrl } from "../../lib/os/integrations/dataos";
import { parseSettingsTab, SETTINGS_TABS, settingsHref } from "../../lib/os/settings";

describe("settings tabs", () => {
  it("has the six sub-tabs in board order", () => {
    expect(SETTINGS_TABS.map((t) => t.label)).toEqual(["Instagram account", "Integrations", "Custom fields", "DM logs", "Diagnostics", "Workspace"]);
  });

  it("parses ?tab= and builds links", () => {
    expect(parseSettingsTab("integrations")).toBe("integrations");
    expect(parseSettingsTab("fields")).toBe("fields");
    expect(parseSettingsTab("nope")).toBe("instagram");
    expect(parseSettingsTab(undefined)).toBe("instagram");
    expect(settingsHref("instagram")).toBe("/os/settings");
    expect(settingsHref("integrations")).toBe("/os/settings?tab=integrations");
  });

  it("cleans the Data OS address", () => {
    expect(cleanBaseUrl("dataos.example.com/")).toEqual({ url: "https://dataos.example.com" });
    expect(cleanBaseUrl("http://localhost:4000/api/")).toEqual({ url: "http://localhost:4000/api" });
    expect(cleanBaseUrl("http://dataos.example.com")).toEqual({ error: "Use an https address." });
    expect(cleanBaseUrl("")).toEqual({ error: "Paste the Data OS address." });
  });
});
