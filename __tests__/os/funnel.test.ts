import { describe, expect, it } from "vitest";
import { columnFor, countByColumn, DEFAULT_FUNNEL, dropOnColumn, funnelColumns, funnelKeyFor } from "@/lib/os/funnel";

const J_FUNNEL = [
  { key: "open", label: "Open" },
  { key: "value", label: "Value" },
  { key: "permission", label: "Permission" },
  { key: "qualify", label: "Qualify" },
  { key: "assure", label: "Assure" },
  { key: "invitation", label: "Invitation" },
  { key: "booked", label: "Booked" },
];

describe("funnelColumns", () => {
  it("is the funnel then Booked, Showed, No-show, Won, Lost; a funnel 'booked' is not doubled", () => {
    const cols = funnelColumns(J_FUNNEL);
    expect(cols.map((c) => c.key)).toEqual(["open", "value", "permission", "qualify", "assure", "invitation", "booked", "showed", "no_show", "won", "lost"]);
    expect(cols.filter((c) => c.group === "funnel")).toHaveLength(6);
  });

  it("falls back to the board's default funnel and dedupes keys", () => {
    expect(funnelColumns(null).slice(0, 6).map((c) => c.label)).toEqual(DEFAULT_FUNNEL.map((s) => s.label));
    expect(funnelColumns([{ key: "Open", label: "Open" }, { key: "open", label: "Open again" }]).filter((c) => c.group === "funnel")).toHaveLength(1);
  });
});

describe("columnFor", () => {
  const cols = funnelColumns(J_FUNNEL);
  it("outcomes win over J's hint", () => {
    expect(columnFor({ stage: "WON", setterStage: "qualify" }, cols)).toBe("won");
    expect(columnFor({ stage: "LOST" }, cols)).toBe("lost");
    expect(columnFor({ stage: "NOT_QUALIFIED", setterStage: "qualify" }, cols)).toBe("lost");
    expect(columnFor({ stage: "SHOWED" }, cols)).toBe("showed");
    expect(columnFor({ stage: "CALL_BOOKED", attendance: "NO_SHOW" }, cols)).toBe("no_show");
    expect(columnFor({ stage: "CALL_BOOKED", setterStage: "booked" }, cols)).toBe("booked");
    expect(columnFor({ stage: "IN_CONVERSATION", setterStage: "booked" }, cols)).toBe("booked");
  });

  it("maps J's state-machine words onto the setter's funnel", () => {
    expect(columnFor({ stage: "IN_CONVERSATION", setterStage: "opener" }, cols)).toBe("open");
    expect(columnFor({ stage: "IN_CONVERSATION", setterStage: "qualify" }, cols)).toBe("qualify");
    expect(columnFor({ stage: "CALL_OFFERED", setterStage: "bridge" }, cols)).toBe("assure");
    expect(funnelKeyFor("invite", cols)).toBe("invitation");
    expect(funnelKeyFor("bridge", funnelColumns(null))).toBe("assure");
    expect(funnelKeyFor("nonsense", cols)).toBeNull();
  });

  it("without a hint, early stages land on the funnel", () => {
    expect(columnFor({ stage: "NEW" }, cols)).toBe("open");
    expect(columnFor({ stage: "QUALIFIED" }, cols)).toBe("qualify");
    expect(columnFor({ stage: "CALL_OFFERED" }, cols)).toBe("invitation");
  });
});

describe("dropOnColumn and counts", () => {
  const cols = funnelColumns(null);
  it("funnel columns set J's hint; outcomes set ContactStage; no-show is not draggable", () => {
    expect(dropOnColumn("qualify", cols)).toEqual({ setterStage: "qualify" });
    expect(dropOnColumn("booked", cols)).toEqual({ stage: "CALL_BOOKED" });
    expect(dropOnColumn("won", cols)).toEqual({ stage: "WON" });
    expect(dropOnColumn("lost", cols)).toEqual({ stage: "LOST" });
    expect(dropOnColumn("showed", cols)).toEqual({ stage: "SHOWED" });
    expect(dropOnColumn("no_show", cols)).toHaveProperty("error");
    expect(dropOnColumn("nope", cols)).toHaveProperty("error");
  });

  it("countByColumn keeps column order and zeroes", () => {
    const counts = countByColumn([{ stage: "NEW" }, { stage: "WON" }, { stage: "IN_CONVERSATION", setterStage: "value" }, { stage: "NEW" }], cols);
    expect(counts.map((c) => c.key)).toEqual(cols.map((c) => c.key));
    expect(Object.fromEntries(counts.map((c) => [c.key, c.count]))).toMatchObject({ open: 2, value: 1, won: 1, lost: 0 });
  });
});
