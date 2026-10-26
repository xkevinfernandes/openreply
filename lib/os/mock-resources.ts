// Sample Resources for OS_MOCK=1 when the database has none yet (the
// Resources canvas): lead magnets, videos and the agents that offer them.

import type { ResourceView } from "@/lib/os/knowledge";
import { buildBoard, type ResourcesBoard } from "@/lib/os/resources-view";

const agents = [
  { id: "mock-setter-j", name: "J" },
  { id: "mock-setter-nova", name: "Nova" },
];

const r = (id: string, kind: ResourceView["kind"], name: string, link: string | null, sent: number, setters: string[], sortOrder: number, when = ""): ResourceView => ({
  id,
  slug: id.replace(/^mock-res-/, ""),
  kind,
  name,
  link,
  keyword: null,
  status: "ACTIVE",
  description: "",
  setterCount: setters.length,
  keywords: [],
  usedBy: agents.filter((a) => setters.includes(a.id)),
  broadcasts: [],
  sent,
  when,
  sortOrder,
});

/** The sample lead magnets, shared with the broadcast picker's sample (lib/os/mock-followups.ts). */
export const MOCK_LEAD_MAGNETS = [
  { id: "mock-res-setter-starter", name: "Claude Code Setter Starter", link: "https://kevinfernandes.me/setter-starter" },
  { id: "mock-res-script-vault", name: "DM Script Vault", link: "https://kevinfernandes.me/script-vault" },
  { id: "mock-res-workshop", name: "The AI DM setter workshop", link: "https://ai.claudepreneur.com" },
  { id: "mock-res-10k-course", name: "The extra $10k course", link: null },
] as const;

/** `broadcasts`: the sample broadcasts using each resource (resourceBroadcastUse on the mock store). */
export function mockResourcesBoard(broadcasts: Map<string, ResourceView["broadcasts"]> = new Map()): ResourcesBoard {
  const resources = [
    r("mock-res-setter-starter", "resource", "Claude Code Setter Starter", "https://kevinfernandes.me/setter-starter", 42, ["mock-setter-j", "mock-setter-nova"], 1),
    r("mock-res-script-vault", "resource", "DM Script Vault", "https://kevinfernandes.me/script-vault", 31, ["mock-setter-j"], 2),
    r("mock-res-workshop", "resource", "The AI DM setter workshop", "https://ai.claudepreneur.com", 18, ["mock-setter-j"], 3),
    r("mock-res-10k-course", "resource", "The extra $10k course", null, 0, ["mock-setter-j"], 4),
    r("mock-res-built-setter", "episode", "How I built a DM setter with Claude", "https://youtube.com/watch?v=sample1", 12, ["mock-setter-j"], 5, "Wants to build it themselves"),
    r("mock-res-dm-scripts", "episode", "The DM scripts that book my calls", "https://youtube.com/watch?v=sample2", 9, ["mock-setter-j", "mock-setter-nova"], 6, "Asks how the calls get booked"),
  ];
  for (const res of resources) res.broadcasts = (broadcasts.get(res.id) ?? []).map((b) => ({ key: b.key, name: b.name, unsent: b.unsent }));
  return buildBoard(
    resources,
    new Map(),
    {
      agents,
      campaigns: [{ automationId: "mock-campaign-setter", resourceId: "mock-res-setter-starter", name: "Campaign SETTER" }],
      workflows: [{ id: "mock-wf-friday", name: "Workshop reminder", slugs: ["workshop"] }],
    },
    [
      { setterId: "mock-setter-j", key: "offers" },
      { setterId: "mock-setter-nova", key: "offers" },
      { setterId: "mock-setter-j", key: "objections" },
      { setterId: "mock-setter-nova", key: "objections" },
      { setterId: "mock-setter-j", key: "business" },
    ],
    true
  );
}
