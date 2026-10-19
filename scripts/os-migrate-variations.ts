// One-off: the old Funnel "Variations" become a DRAFT line test per stage
// (Knowledge bases › setter › Tests), and leave the funnel. Safe to re-run:
// text already in a test for that setter and line isn't copied twice.
// Dry run by default; --apply writes.
//
//   npx tsx scripts/os-migrate-variations.ts [--workspace <id>] [--apply]

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { planVariationMigration } from "@/lib/os/experiments/migrate-variations";
import { LINE_MIN_REACHED } from "@/lib/os/experiments/stats";
import { STAGE_LINES } from "@/lib/os/experiments/types";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const workspaceId = flag("--workspace");
const apply = args.includes("--apply");

async function main() {
  const ws = workspaceId ? { workspaceId } : {};
  const [setters, experiments] = await Promise.all([
    prisma.setter.findMany({ where: ws, select: { id: true, workspaceId: true, name: true, funnel: true } }),
    prisma.experiment.findMany({ where: { ...ws, setterId: { not: null } }, select: { setterId: true, slot: true, variants: { select: { text: true } } } }),
  ]);
  const plan = planVariationMigration(
    setters,
    experiments.map((e) => ({ setterId: e.setterId, slot: e.slot, texts: e.variants.map((v) => v.text) }))
  );

  const label = (k: string) => STAGE_LINES.find((l) => l.key === k)?.label ?? k;
  for (const c of plan.create) console.log(`${apply ? "create" : "would create"} draft test · ${c.setterName} · ${c.stage} → ${label(c.line)} · ${c.texts.length} version(s)`);
  for (const a of plan.already) console.log(`already migrated · ${a.setterName} · ${a.stage} → ${label(a.line)}`);
  for (const s of plan.skipped) console.log(`skipped (no stage line fits) · ${s.setterName} · ${s.stage} · ${s.texts} variation(s) left in the funnel`);
  console.log(`${plan.create.length} to create, ${plan.already.length} already done, ${plan.skipped.length} skipped, ${plan.funnels.length} funnel(s) to clean.`);
  if (!apply) {
    console.log("Dry run. Pass --apply to write.");
    return;
  }

  for (const c of plan.create) {
    await prisma.experiment.create({
      data: {
        workspaceId: c.workspaceId,
        setterId: c.setterId,
        name: label(c.line),
        slot: c.slot,
        status: "DRAFT",
        allocation: "EVEN",
        minSends: LINE_MIN_REACHED,
        notes: `Migrated from the Funnel variations of "${c.stage}".`,
        variants: { create: c.texts.map((text, i) => ({ label: String.fromCharCode(65 + i), text, sortOrder: i })) },
      },
    });
  }
  // Only after the tests exist: a crash in between re-runs as "already migrated".
  for (const f of plan.funnels) {
    await prisma.setter.update({ where: { id: f.setterId }, data: { funnel: f.funnel as unknown as Prisma.InputJsonValue } });
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
