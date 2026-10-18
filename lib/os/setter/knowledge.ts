// J's knowledge from the markdown bundled in this repo.
//
// method.md (the Setting Script) is the shared method and STAYS here: it ships
// with the code and clients can't edit it (spec item 12). setter.config.json
// (timers, models) stays too.
//
// Everything under claudepreneur/ is the per-setter knowledge from before
// build step 4. It now lives in Postgres (Setter + Resource rows, edited in
// Knowledge bases). These copies are only (a) the source for the one-time
// import (scripts/os-import-knowledge.ts) and (b) the FALLBACK J uses for a
// workspace that has no Setter row yet. Once every workspace has a Setter,
// claudepreneur/ can be deleted.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { KnowledgeSource, ResolvedSetter } from "@/lib/os/setter/kb";
import { profileFromFiles, type ClientSettings, type KnowledgeFiles } from "@/lib/os/setter/profile";
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

/** The file-based setter: what J used before knowledge bases existed. */
export function fileSetter(clientId = "claudepreneur"): ResolvedSetter {
  const k = loadKnowledge(clientId);
  const catalog = loadCatalog(clientId);
  const settings = k.settings ?? {};
  if (catalog.tag_options?.length && !settings.tag_options) settings.tag_options = catalog.tag_options;
  return {
    source: "files",
    setterId: null,
    autonomy: settings.autonomy === "auto" ? "auto" : "approve",
    profile: profileFromFiles(k),
    catalog,
    offered: catalog,
  };
}

/** A KnowledgeSource that always answers from the files (tests, fallback). */
export function fileKnowledgeSource(clientId = "claudepreneur"): KnowledgeSource {
  return {
    forContact: async () => fileSetter(clientId),
    forSetter: async () => fileSetter(clientId),
  };
}
