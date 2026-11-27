import { describe, expect, it } from "vitest";
import { countTime, overlappingEntryIds, runningIntervals } from "../../server/modules/time/workedTime";

/** #400, ADR-0031: Worked Time counts each hour once; Simultaneous Time is when two or more ran. */

const MIN = 60_000;
const entry = (id: string, crmProjectId: string, from: number, to: number) => ({
  id,
  userId: "u",
  crmProjectId,
  seconds: ((to - from) * MIN) / 1000,
  intervals: [{ start: from * MIN, end: to * MIN }],
});

describe("Worked Time (#400)", () => {
  it("counts three Timers once, and only the time two or more ran as simultaneous", () => {
    const count = countTime([entry("a", "p1", 0, 60), entry("b", "p2", 30, 90), entry("c", "p3", 45, 75)]);
    expect(count.workedByUser.get("u")).toBe(90 * 60);
    expect(count.simultaneousByUser.get("u")).toBe(45 * 60);
    const shares = Array.from(count.workedShareByEntry.values()).reduce((sum, s) => sum + s, 0);
    expect(shares).toBe(90 * 60);
  });

  it("keeps every figure whole when nothing overlaps", () => {
    const count = countTime([entry("a", "p1", 0, 30), entry("b", "p1", 40, 60)]);
    expect(count.workedByUser.get("u")).toBe(50 * 60);
    expect(count.simultaneousByUser.get("u")).toBe(0);
    expect(count.projectByUser.get("u")?.get("p1")).toBe(50 * 60);
  });

  it("counts a Project once when two of its Tasks run together", () => {
    const count = countTime([entry("a", "p1", 0, 60), entry("b", "p1", 0, 60)]);
    expect(count.projectByUser.get("u")?.get("p1")).toBe(60 * 60);
  });

  it("cuts the overlap to the window", () => {
    const count = countTime([entry("a", "p1", 0, 60), entry("b", "p2", 0, 60)], {
      start: new Date(30 * MIN),
      end: new Date(60 * MIN),
    });
    // Seconds come in already cut; here they are the whole hour each, so only the overlap inside is taken off.
    expect(count.simultaneousByUser.get("u")).toBe(30 * 60);
  });

  it("takes the pauses out of a Timer's running intervals, and ends an unclosed run at the span's end", () => {
    const at = (m: number) => new Date(m * MIN);
    const intervals = runningIntervals({ start: at(0), end: at(90) }, [
      { kind: "start", at: at(0) },
      { kind: "pause", at: at(10) },
      { kind: "resume", at: at(50) },
    ]);
    expect(intervals).toEqual([
      { start: 0, end: 10 * MIN },
      { start: 50 * MIN, end: 90 * MIN },
    ]);
  });

  it("finds only entries whose wall time meets another of the same Member", () => {
    const at = (m: number) => new Date(m * MIN);
    const found = overlappingEntryIds([
      { id: "a", userId: "u", span: { start: at(0), end: at(30) } },
      { id: "b", userId: "u", span: { start: at(20), end: at(40) } },
      { id: "c", userId: "u", span: { start: at(40), end: at(50) } },
      { id: "d", userId: "v", span: { start: at(0), end: at(60) } },
    ]);
    expect(Array.from(found).sort()).toEqual(["a", "b"]);
  });
});
