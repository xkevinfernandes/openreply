// "One stage writer" (dm-crm issue 003): only lib/os/stage-writer.ts writes
// the contact stage, J's stage hint or booking attendance. A source scan, so a
// future direct write is caught.
import { describe, expect, it } from "vitest";
import { findWrites, scanText } from "./source-scan";

const MODELS = ["contact", "booking"];
const FIELDS = ["stage", "setterStage", "attendance"];
const ALLOWED = new Set([
  "lib/os/stage-writer.ts",
  // Sample data for a local dev database (never production).
  "scripts/os-seed-dev.ts",
]);

describe("stage writer source scan", () => {
  it("no module but the stage writer writes stage, setterStage or attendance", () => {
    const hits = findWrites(MODELS, FIELDS).filter((h) => !ALLOWED.has(h.file));
    expect(hits).toEqual([]);
  });

  it("catches a planted direct write (Prisma, nested, shorthand and raw SQL)", () => {
    const planted = [
      `await prisma.contact.update({ where: { id }, data: { stage: "WON" } });`,
      `await tx.contact.updateMany({ where: { id, stage: { not: "WON" } }, data: { setterStage } });`,
      `await db.booking.upsert({ where: { id }, create: { x: 1 }, update: { attendance: null } });`,
      "await prisma.$executeRaw`UPDATE \"Contact\" SET \"stage\" = 'LOST' WHERE id = ${id}`;",
    ];
    for (const src of planted) expect(scanText("lib/os/planted.ts", src, MODELS, FIELDS)).toHaveLength(1);
  });

  it("doesn't flag reads or a where clause on stage", () => {
    const fine = [
      `await prisma.contact.updateMany({ where: { workspaceId, stage: { in: ["WON"] } }, data: { paused: true } });`,
      `await prisma.contact.findMany({ where: { stage: "WON" }, select: { stage: true } });`,
      "await prisma.$queryRaw`SELECT \"stage\" FROM \"Contact\" FOR UPDATE`;",
    ];
    for (const src of fine) expect(scanText("lib/os/fine.ts", src, MODELS, FIELDS)).toEqual([]);
  });
});
