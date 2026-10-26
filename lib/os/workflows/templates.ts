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
  {
    id: "waitlist_questions",
    name: "Waitlist + questions",
    description: "Early-access list: their email, then three optional quick-reply questions. Filled in for the Founder Engine mini-series.",
  },
  { id: "blank", name: "Blank", description: "Just a trigger." },
];

/** Left to right: step i at x = i·320; side branches drop below (y). */
const at = (i: number, y = 0) => ({ x: i * 320, y });
const node = (id: string, type: GraphNode["type"], i: number, data: unknown, y = 0): GraphNode => ({ id, type, position: at(i, y), data });
const edge = (from: string, fromPort: string, to: string): GraphEdge => ({ id: `${from}-${fromPort}-${to}`.replace(/[^a-zA-Z0-9_-]/g, "_"), from, fromPort, to });

const PUBLIC_REPLIES = ["sent you a DM 🙌", "check your DMs!", "just sent it over 👀"];

/** Templates whose own positions are kept (the canvas doesn't re-lay them out). */
export const HAND_LAID: TemplateId[] = ["waitlist_questions"];

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
    case "waitlist_questions":
      return waitlistGraph(opts.keyword ?? "FOUNDER");
    case "blank":
      return { version: 1, nodes: [trigger], edges: [] };
  }
}

/**
 * Waitlist + questions (first used for the Founder Engine mini-series):
 * join → email → on the waitlist → three quick-reply questions, never
 * mandatory. No answer ends the run Quiet and they stay on the waitlist.
 * Finishing tags qual-complete. Revenue $5K+ options are marked qualifies, so
 * By reel counts them; the Revenue field stays the source of truth, no tag.
 * No email (refused, or wrong twice) ends the run before "you're on the list".
 */
function waitlistGraph(keyword: string): WorkflowGraph {
  const role = [
    { id: "coach", label: "Coach" },
    { id: "consultant", label: "Consultant" },
    { id: "agency", label: "Agency owner" },
    { id: "other", label: "Something else" },
  ];
  const revenue = [
    { id: "none", label: "Not earning yet" },
    { id: "u5k", label: "Under $5K" },
    { id: "5to10", label: "$5K–$10K", qualifies: true },
    { id: "10to20", label: "$10K–$20K", qualifies: true },
    { id: "20plus", label: "$20K+", qualifies: true },
  ];
  const blocker = [
    { id: "leads", label: "Getting leads" },
    { id: "convert", label: "Converting leads" },
    { id: "scale", label: "Delivering at scale" },
    { id: "unsure", label: "Not sure" },
  ];
  return {
    version: 1,
    nodes: [
      node("trigger", "trigger", 0, { kind: "comment", keywords: [keyword], postIds: "any", publicReplies: PUBLIC_REPLIES, reentry: { mode: "after_days", days: 30 } }),
      node("join", "message", 1, {
        bubbles: [
          {
            kind: "buttons",
            text: "Hey! I'm putting together the free Founder Engine mini-series for coaches and consultants.\n\nIt's not released just yet, but you can get on the early-access list so you're first to know when it's ready.\n\nTap below to join.",
            buttons: [{ id: "join", label: "Join Early Access" }],
          },
        ],
      }),
      node("email", "ask", 2, {
        question: "Perfect! What's the best email address to send your early-access updates to? (you can unsubscribe anytime)",
        saveTo: "email",
        validate: "email",
        retry: "Hmm, that doesn't look like an email. Can you send me an actual email address?",
      }),
      node("has_email", "condition", 3, { rule: { kind: "field_set", value: "email" } }),
      node("no_email", "end", 3, {}, 300),
      node("waitlist", "action", 4, {
        ops: [
          { op: "add_tag", key: "waitlist-founder-engine" },
          { op: "set_field", key: "lead_magnet", value: "Founder Engine Mini-Series" },
        ],
      }),
      node("listed", "message", 5, {
        bubbles: [
          {
            kind: "buttons",
            text: "You're on the early-access list! ✅ Keep an eye out for a confirmation email.\n\nQuick one — I've got three questions that take less than 20 seconds.\n\nYour answers will help me tailor the free resources I'm building for you.\n\nWant to help me out?",
            buttons: [
              { id: "sure", label: "Sure" },
              { id: "later", label: "Maybe later" },
            ],
          },
        ],
      }),
      node("later", "end", 6, {}, 340),
      node("q_role", "message", 6, {
        bubbles: [{ kind: "quick_replies", text: "First up, what do you do?", options: role, saveTo: "business" }],
      }),
      node("ask_role", "ask", 7, { question: "Got it! What is it that you do?", saveTo: "business", validate: "text" }, 300),
      node("q_revenue", "message", 8, {
        bubbles: [{ kind: "quick_replies", text: "Roughly how much revenue is your business currently generating per month?", options: revenue, saveTo: "monthly_revenue" }],
      }),
      node("q_blocker", "message", 9, {
        bubbles: [{ kind: "quick_replies", text: "And what's the biggest thing holding your business back right now?", options: blocker, saveTo: "their_challenge" }],
      }),
      node("complete", "action", 10, { ops: [{ op: "add_tag", key: "qual-complete" }] }),
      node("wrapup", "message", 11, {
        bubbles: [
          {
            kind: "text",
            text: "Amazing, thanks! ✅\n\nThat helps me make sure the resources I create are actually useful.\n\nKeep an eye on your inbox — I'll send you an update on the mini-series within the next 14 days.",
          },
        ],
      }),
      node("end", "end", 12, {}),
    ],
    edges: [
      edge("trigger", "next", "join"),
      edge("join", "button:join", "email"),
      edge("email", "next", "has_email"),
      // On the waitlist only once there's an email.
      edge("has_email", "yes", "waitlist"),
      edge("has_email", "no", "no_email"),
      edge("waitlist", "next", "listed"),
      edge("listed", "button:sure", "q_role"),
      edge("listed", "button:later", "later"),
      edge("q_role", "reply:coach", "q_revenue"),
      edge("q_role", "reply:consultant", "q_revenue"),
      edge("q_role", "reply:agency", "q_revenue"),
      edge("q_role", "reply:other", "ask_role"),
      // Typed, matched nothing twice: what they typed is already saved.
      edge("q_role", "other", "q_revenue"),
      edge("ask_role", "next", "q_revenue"),
      ...revenue.map((o) => edge("q_revenue", `reply:${o.id}`, "q_blocker")),
      // "other" on the last two isn't connected: it follows the first option.
      ...blocker.map((o) => edge("q_blocker", `reply:${o.id}`, "complete")),
      edge("complete", "next", "wrapup"),
      edge("wrapup", "next", "end"),
    ],
  };
}
