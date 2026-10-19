// J as an agent with tools (spec 2026-10-19-setter-agent-spec.md §2), behind
// OS_J_TOOLS=1. Off (the default) = the legacy one-call drafter, unchanged.
//
//   tools.ts    the tool definitions (read / action / reply)
//   context.ts  what a turn knows + the read tools
//   actions.ts  action checks, and the mapping onto the legacy draft object
//   loop.ts     the tool loop (runAgentTurn)
//   backends.ts Anthropic tool use, or the scripted fake
//   brief.ts    the prompt parts that differ with tools
//   trace.ts    DraftTrace, saved on Draft.raw.trace

import type { DrafterBackend } from "@/lib/os/setter/config";
import { backendFor, type AgentBackend } from "@/lib/os/setter/agent/backends";
import type { FieldValueView } from "@/lib/os/setter/agent/context";

export { runAgentTurn, type AgentTurn } from "@/lib/os/setter/agent/loop";
export type { AgentEnv, AgentContact } from "@/lib/os/setter/agent/context";
export type { DraftTrace } from "@/lib/os/setter/agent/trace";
export { scriptedBackend, type AgentBackend, type FakeStep } from "@/lib/os/setter/agent/backends";

/** OS_J_TOOLS=1 switches J to the tool loop. */
export function jToolsFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OS_J_TOOLS === "1";
}

/**
 * The tool-loop backend to use, or null for the legacy path: the flag is off,
 * or the drafter is the local claude CLI (no tool use there). A test may pass
 * its own backend (a script), which wins when the flag is on.
 */
export function agentBackend(drafter: DrafterBackend, override?: AgentBackend | null, env: NodeJS.ProcessEnv = process.env): AgentBackend | null {
  if (!jToolsFlag(env)) return null;
  return override ?? backendFor(drafter);
}

/** Fields filled so far for a contact, with who filled them (Postgres). */
export async function dbFieldValues(contactId: string): Promise<FieldValueView[]> {
  const { prisma } = await import("@/lib/db/client");
  const rows = await prisma.contactFieldValue.findMany({
    where: { contactId },
    select: { value: true, source: true, field: { select: { key: true, label: true } } },
  });
  return rows.map((r) => ({ key: r.field.key, label: r.field.label, value: r.value, source: r.source }));
}
