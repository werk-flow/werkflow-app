import { expect, test } from "bun:test";
import { ensureRealtimeHealthy, type RealtimeProbeResult } from "./realtime-health";

function probes(results: RealtimeProbeResult[]): { probe: () => Promise<RealtimeProbeResult>; calls: () => number } {
  let index = 0;
  return { probe: async () => results[Math.min(index++, results.length - 1)]!, calls: () => index };
}

test("a fast readiness answer needs no restart", async () => {
  const restarts: number[] = [];
  const { probe, calls } = probes([{ ok: true, elapsedMs: 800 }]);
  const result = await ensureRealtimeHealthy({ probe, restart: () => restarts.push(1), maxElapsedMs: 5_000, log: () => undefined });
  expect(result).toEqual({ ok: true, elapsedMs: 800 });
  expect(restarts).toEqual([]);
  expect(calls()).toBe(1);
});

test("a slow or failed answer restarts the service once and accepts the second answer", async () => {
  const lines: string[] = [];
  let restarts = 0;
  const slow = probes([{ ok: true, elapsedMs: 9_000 }, { ok: true, elapsedMs: 12_000 }]);
  const result = await ensureRealtimeHealthy({ probe: slow.probe, restart: () => { restarts += 1; }, maxElapsedMs: 5_000, log: (line) => lines.push(line) });
  expect(result.elapsedMs).toBe(12_000);
  expect(restarts).toBe(1);
  expect(lines[0]).toContain("took 9000 ms");
  const failed = probes([{ ok: false, elapsedMs: 30_000, detail: "no readiness message within 30 s" }, { ok: true, elapsedMs: 4_000 }]);
  await ensureRealtimeHealthy({ probe: failed.probe, restart: () => { restarts += 1; }, maxElapsedMs: 5_000, log: () => undefined });
  expect(restarts).toBe(2);
});

test("a failure after the restart stops the run with the remedy", async () => {
  const { probe } = probes([{ ok: false, elapsedMs: 30_000, detail: "join TIMED_OUT" }]);
  await expect(ensureRealtimeHealthy({ probe, restart: () => undefined, maxElapsedMs: 5_000, log: () => undefined })).rejects.toThrow("not healthy after a restart (join TIMED_OUT)");
});
