// What the canvas nodes and the inspector look things up in: fields for
// "Saves to", lead magnets, setters, other workflows, line tests, stats.

import type { WorkflowStats } from "@/components/os/workflows/types";
import type { StageLineRow } from "@/lib/os/experiments/data";

export interface FieldOption {
  key: string;
  label: string;
  /** Pushed to Kit / GoHighLevel. */
  kit: boolean;
  ghl: boolean;
}

export interface ResourceOption {
  slug: string;
  name: string;
  link: string | null;
}

export interface SetterOption {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface BuilderContext {
  fields: FieldOption[];
  resources: ResourceOption[];
  setters: SetterOption[];
  workflows: { id: string; name: string }[];
  /** Line tests per setter id (Knowledge bases › Tests rows). */
  lineTests: Record<string, StageLineRow[]>;
  stats: WorkflowStats | null;
}

export function fieldLabel(ctx: Pick<BuilderContext, "fields">, key: string): string {
  return ctx.fields.find((f) => f.key === key)?.label ?? key;
}

export function resourceName(ctx: Pick<BuilderContext, "resources">, slug: string | undefined): string {
  if (!slug) return "";
  return ctx.resources.find((r) => r.slug === slug)?.name ?? slug;
}

/** The step's setter, else the default one. */
export function setterOf(ctx: Pick<BuilderContext, "setters">, id: string | undefined): SetterOption | null {
  return ctx.setters.find((s) => s.id === id) ?? ctx.setters.find((s) => s.isDefault) ?? ctx.setters[0] ?? null;
}

export function syncTitle(f: FieldOption | undefined): string | null {
  if (!f) return null;
  if (f.kit && f.ghl) return "Syncs to Kit and GoHighLevel";
  if (f.kit) return "Syncs to Kit";
  if (f.ghl) return "Syncs to GoHighLevel";
  return null;
}
