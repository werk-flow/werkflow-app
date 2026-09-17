import { expect, test } from "bun:test";
import { ResponsivenessError } from "./live-observation";
import { responsivenessLimitMs, toleratingResponsiveness } from "./responsiveness-tolerance";

const over = (measuredMs: number, targetMs = 2000) =>
  new ResponsivenessError({ status: "visible", correctness: "observed", responsiveness: "over_target", targetMs, measuredMs });

test("the tolerance limit is the larger of 25 percent and 250 ms above the target", () => {
  expect(responsivenessLimitMs(2000)).toBe(2500);
  expect(responsivenessLimitMs(5000)).toBe(6250);
  expect(responsivenessLimitMs(500)).toBe(750);
});

test("an over-target raise inside the limit resolves with the measured time; beyond it or any other failure rethrows", async () => {
  expect(await toleratingResponsiveness(2000, async () => 1500)).toBe(1500);
  expect(await toleratingResponsiveness(2000, async () => { throw over(2500); })).toBe(2500);
  await expect(toleratingResponsiveness(2000, async () => { throw over(2501); })).rejects.toBeInstanceOf(ResponsivenessError);
  await expect(toleratingResponsiveness(2000, async () => { throw new Error("mutation failed"); })).rejects.toThrow("mutation failed");
});
