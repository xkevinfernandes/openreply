// "One tag writer" (dm-crm issue 005): only lib/os/fields/write.ts writes
// contact tags. A source scan, so a future direct write is caught.
import { describe, expect, it } from "vitest";
import { findWrites, scanText } from "./source-scan";

const ALLOWED = new Set([
  "lib/os/fields/write.ts",
  // Sample data for a local dev database (never production).
  "scripts/os-seed-dev.ts",
]);

describe("tag writer source scan", () => {
  it("no module but the tag writer writes Contact.tags", () => {
    expect(findWrites(["contact"], ["tags"]).filter((h) => !ALLOWED.has(h.file))).toEqual([]);
  });

  it("catches a planted direct write", () => {
    expect(scanText("lib/os/x.ts", `await prisma.contact.update({ where: { id }, data: { tags: [...c.tags, "hot"] } });`, ["contact"], ["tags"])).toHaveLength(1);
    expect(scanText("lib/os/x.ts", `await prisma.contact.create({ data: { workspaceId, tags } });`, ["contact"], ["tags"])).toHaveLength(1);
    expect(scanText("lib/os/x.ts", "await prisma.$executeRaw`UPDATE \"Contact\" SET \"tags\" = ${t}`;", ["contact"], ["tags"])).toHaveLength(1);
    expect(scanText("lib/os/x.ts", `await prisma.contact.findMany({ where: { tags: { has: "hot" } } });`, ["contact"], ["tags"])).toEqual([]);
  });
});
