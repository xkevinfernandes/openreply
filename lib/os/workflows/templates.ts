// The starting graphs on "New workflow". Each is a valid WorkflowGraph; the
// builder fills in the keyword and resource before Publish.

import type { TemplateId, TemplateInfo } from "@/lib/os/workflows/api";
import type { GraphEdge, GraphNode, WorkflowGraph } from "@/lib/os/workflows/graph";

export const TEMPLATES: TemplateInfo[] = [
  {
    id: "hold_lead_magnet",
    name: "Hold the lead magnet",
    description: "\"Caught your comment, want me to drop it below?\" J books the call and releases the guide by rule.",
  },
  { id: "send_link", name: "Simple: send the link", description: "Tap the button, get the link. Today's campaign flow." },
  { id: "start_conversation", name: "Start a conversation", description: "Opener, then J talks until there's real engagement." },
  { id: "blank", name: "Blank", description: "Just a trigger." },
];

/** Left to right: step i at x = i·280; side branches drop below (y). */
const at = (i: number, y = 0) => ({ x: i * 280, y });
const node = (id: string, type: GraphNode["type"], i: number, data: unknown, y = 0): GraphNode => ({ id, type, position: at(i, y), data });
const edge = (from: string, fromPort: string, to: string): GraphEdge => ({ id: `${from}-${fromPort}-${to}`.replace(/[^a-zA-Z0-9_-]/g, "_"), from, fromPort, to });

const PUBLIC_REPLIES = ["sent you a DM 🙌", "check your DMs!", "just sent it over 👀"];

export function templateGraph(id: TemplateId, opts: { keyword?: string; resource?: string } = {}): WorkflowGraph {
  const keyword = opts.keyword ?? "GUIDE";
  const resources = opts.resource ? [opts.resource] : [];
  const trigger = node("trigger", "trigger", 0, { kind: "comment", keywords: [keyword], postIds: "any", publicReplies: PUBLIC_REPLIES, reentry: { mode: "after_days", days: 30 } });
  switch (id) {
    case "hold_lead_magnet":
      return {
        version: 1,
        nodes: [
          trigger,
          node("opener", "message", 1, { bubbles: [{ kind: "text", text: "hey! caught your comment, want me to drop it below?" }] }),
          node("setter", "setter", 2, {
            goal: "book_call",
            leadMagnet: { mode: "hold", resources },
            release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true },
            quietHours: [18, 22],
            saveTo: [],
          }),
          node("ghosted", "action", 3, { ops: [{ op: "add_tag", key: "ghosted" }, { op: "friday" }] }, 200),
          node("end", "end", 4, {}),
        ],
        edges: [edge("trigger", "next", "opener"), edge("opener", "next", "setter"), edge("setter", "exit:quiet", "ghosted"), edge("ghosted", "next", "end")],
      };
    case "send_link":
      return {
        version: 1,
        nodes: [
          trigger,
          node("opener", "message", 1, { bubbles: [{ kind: "buttons", text: "hey! here's what you asked for, tap below and I'll send it 👇", buttons: [{ id: "send", label: "Send it" }] }] }),
          node("link", "message", 2, { bubbles: [{ kind: "text", text: "here you go:" }, { kind: "link", ...(opts.resource ? { resourceSlug: opts.resource } : { url: "https://example.com" }) }] }),
          node("end", "end", 3, {}),
        ],
        edges: [edge("trigger", "next", "opener"), edge("opener", "button:send", "link"), edge("link", "next", "end")],
      };
    case "start_conversation":
      return {
        version: 1,
        nodes: [
          trigger,
          node("opener", "message", 1, { bubbles: [{ kind: "text", text: "hey! saw your comment, what made you drop it?" }] }),
          node("setter", "setter", 2, {
            goal: "start_conversation",
            leadMagnet: { mode: "none", resources: [] },
            release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true },
            quietHours: [18, 22],
            saveTo: [],
          }),
          node("end", "end", 3, {}),
        ],
        edges: [edge("trigger", "next", "opener"), edge("opener", "next", "setter"), edge("setter", "exit:goal_met", "end")],
      };
    case "blank":
      return { version: 1, nodes: [trigger], edges: [] };
  }
}
