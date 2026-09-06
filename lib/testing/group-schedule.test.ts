import { expect, test } from "bun:test";
import { runGroupSchedule } from "./group-schedule";

test("independent groups overlap within two slots; freshness and database gates remain exclusive", async () => {
  let active = 0;
  let maximum = 0;
  const visits: string[] = [];
  await runGroupSchedule({
    entries: ["static", "audit-a", "audit-b", "freshness", "audit-c", "sql"],
    jobs: 2,
    canOverlap: (entry) => entry.startsWith("audit"),
    run: async (entry) => {
      active++;
      maximum = Math.max(maximum, active);
      if (!entry.startsWith("audit")) expect(active).toBe(1);
      visits.push(entry);
      await Promise.resolve();
      active--;
    },
  });
  expect(maximum).toBe(2);
  expect(visits).toEqual(["static", "audit-a", "audit-b", "freshness", "audit-c", "sql"]);
});

test("a failed result does not suppress unrelated entries; unexpected runner errors wait for active work", async () => {
  const outcomes: string[] = [];
  await runGroupSchedule({ entries: ["failed", "passed"], jobs: 1, canOverlap: () => true, run: async (entry) => { outcomes.push(entry); } });
  expect(outcomes).toEqual(["failed", "passed"]);
  let peerFinished = false;
  await expect(runGroupSchedule({ entries: ["crash", "peer"], jobs: 2, canOverlap: () => true, run: async (entry) => {
    if (entry === "crash") throw new Error("runner failed");
    await Promise.resolve(); peerFinished = true;
  } })).rejects.toThrow("runner failed");
  expect(peerFinished).toBe(true);
});
