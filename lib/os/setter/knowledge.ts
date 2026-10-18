// Loads J's knowledge from the markdown bundled in this repo.
//
// TEMPORARY (build step 3): these files are copies of the DM Setter repo's
// `DM Setter/Setting Script.md`, `clients/claudepreneur/` and
// `scripts/dms/resources.json`. Railway can't read that repo, so the fork ships
// its own copy; step 4 moves the per-setter parts into Postgres (Knowledge
// base UI) and this loader goes away. Until then, edits made in the DM Setter
// repo must be copied here too.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ClientSettings, KnowledgeFiles } from "@/lib/os/setter/profile";
import type { Catalog } from "@/lib/os/setter/types";

const ROOT = path.join(process.cwd(), "lib", "os", "setter", "knowledge");

function read(...parts: string[]): string {
  try {
    return readFileSync(path.join(ROOT, ...parts), "utf8");
  } catch {
    return "";
  }
}

function readJson<T>(fallback: T, ...parts: string[]): T {
  const raw = read(...parts).trim();
  return raw ? (JSON.parse(raw) as T) : fallback;
}

/** The shared method (Setting Script), with the Obsidian frontmatter and
 *  info banner removed: those are for Kevin, not the model. */
export function loadMethod(): string {
  let body = read("method.md").replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  body = body.replace(/^(> \[!info\].*\n(>.*\n)*)\n?/, "");
  return body;
}

export function loadKnowledge(clientId = "claudepreneur", setter?: string): KnowledgeFiles {
  const settings = readJson<ClientSettings>({}, clientId, "settings.json");
  const setterName = setter || settings.active_setter || "default";
  const s = (file: string) => read(clientId, "setters", setterName, file);
  return {
    clientId,
    setterName,
    settings,
    offer: read(clientId, "offer.md"),
    offers: read(clientId, "offers.md"),
    voice: s("voice.md"),
    funnel: s("funnel.md"),
    playbook: s("playbook.md"),
    conversationExamples: s("conversation-examples.md"),
    voiceCorrections: read(clientId, "memory", "voice-corrections.md"),
  };
}

export function loadCatalog(clientId = "claudepreneur"): Catalog {
  return readJson<Catalog>({ resources: [] }, clientId, "resources.json");
}

export function loadSetterConfigFile(): Record<string, unknown> {
  return readJson<Record<string, unknown>>({}, "setter.config.json");
}
