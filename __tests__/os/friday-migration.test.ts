import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fridayTags, onFridayList } from "@/lib/os/broadcasts/migrate";
import { mockBroadcastStore } from "@/lib/os/mock-followups";
import { FOLLOW_UP_FRIDAY } from "@/lib/os/broadcasts/types";

const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261020020000_os_ui_data/migration.sql"), "utf8");

describe("Friday list → follow-up-friday tag", () => {
  it("the data migration tags every onFriday contact once and seeds the broadcast", () => {
    expect(sql).toMatch(/SET "tags" = array_append\("tags", 'follow-up-friday'\)/);
    expect(sql).toMatch(/WHERE "onFriday" = true AND NOT \('follow-up-friday' = ANY\("tags"\)\)/);
    expect(sql).toMatch(/INSERT INTO "Broadcast"[\s\S]*'follow-up-friday', 'Follow-up Friday', 'follow-up-friday'/);
    expect(sql).toMatch(/ON CONFLICT \("workspaceId", "key"\) DO NOTHING/);
  });

  it("writes keep tag and flag in step, idempotently", () => {
    expect(fridayTags(["hot"], true)).toEqual(["hot", "follow-up-friday"]);
    expect(fridayTags(["hot", "follow-up-friday"], true)).toEqual(["hot", "follow-up-friday"]);
    expect(fridayTags(["follow-up-friday", "hot"], false)).toEqual(["hot"]);
    expect(onFridayList({ tags: [], onFriday: true })).toBe(true);
    expect(onFridayList({ tags: ["follow-up-friday"], onFriday: false })).toBe(true);
    expect(onFridayList({ tags: ["hot"] })).toBe(false);
  });

  it("sample data: the legacy Friday flags carry the tag, one broadcast", async () => {
    const store = mockBroadcastStore();
    const tagged = await store.taggedContacts("ws-test", FOLLOW_UP_FRIDAY.tag);
    const ids = tagged.map((c) => c.contactId);
    // c1 maya, c6 lena, c8 sam, c10 dev had onFriday=true in the old sample
    for (const id of ["c1", "c6", "c8", "c10"]) expect(ids).toContain(id);
    const list = await store.list("ws-test");
    expect(list.map((b) => b.key)).toEqual(["follow-up-friday"]);
    expect(list[0].template).toContain("{first_name}");
  });
});
