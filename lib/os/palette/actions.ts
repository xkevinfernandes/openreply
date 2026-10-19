"use server";

// Server actions the ⌘K palette calls from the client (it is mounted by the
// shell with no props, so it fetches its own index).

import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadPaletteIndex, searchSetterDocs, type DocHit, type PaletteIndex } from "@/lib/os/palette/data";

export async function paletteIndex(): Promise<PaletteIndex | null> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  try {
    return await loadPaletteIndex(workspaceId);
  } catch (err) {
    console.error("[OS Palette] index:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function paletteDocs(q: string): Promise<DocHit[]> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return [];
  try {
    return await searchSetterDocs(workspaceId, String(q ?? "").slice(0, 120));
  } catch (err) {
    console.error("[OS Palette] docs:", err instanceof Error ? err.message : err);
    return [];
  }
}
