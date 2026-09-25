import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeJsonAtomically } from "./file-lock";
import { discoveredTestSchema, selectionOf, type DiscoveredPlaywrightTest, type PlaywrightSelection } from "./playwright-discovery";
import type { PlaywrightSuite, PlaywrightTarget } from "./run-policy";

/**
 * A verification run does the expensive shared work once (server and backend
 * preflight, suite discovery, qualification) and hands the result to every
 * group it starts through this file; the group runner then skips that work.
 */
export const PREPARED_PLAN_ENV = "WERKFLOW_PREPARED_PLAN";

const preparedPlanSchema = z.object({
  version: z.literal(1),
  target: z.enum(["local", "cloud"]),
  preparedAt: z.string(),
  buildId: z.string().nullable(),
  discoveries: z.object({
    golden: z.array(discoveredTestSchema).optional(),
    audit: z.array(discoveredTestSchema).optional(),
    canary: z.array(discoveredTestSchema).optional(),
  }),
  groups: z.record(z.string(), z.object({ fingerprint: z.string(), runKey: z.string() })),
});
export type PreparedPlan = z.infer<typeof preparedPlanSchema>;
export type PreparedGroupRun = { fingerprint: string; runKey: string; selection: PlaywrightSelection };

export function writePreparedPlan(path: string, plan: PreparedPlan): void {
  writeJsonAtomically(path, preparedPlanSchema.parse(plan));
}

/** The plan named by the environment, or null outside a verification run. */
export function readPreparedPlan(environment: Readonly<Record<string, string | undefined>> = process.env): PreparedPlan | null {
  const path = environment[PREPARED_PLAN_ENV];
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`${PREPARED_PLAN_ENV} names a missing file: ${path}`);
  return preparedPlanSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** The prepared identity and discovery of one group run; every mismatch is an error, never a silent fallback. */
export function preparedGroupRun(plan: PreparedPlan, input: { groupId: string; suite: PlaywrightSuite; target: PlaywrightTarget }): PreparedGroupRun {
  if (plan.target !== input.target) throw new Error(`The prepared plan targets ${plan.target}; this group run targets ${input.target}.`);
  const group = plan.groups[input.groupId];
  if (!group) throw new Error(`The prepared plan holds no entry for ${input.groupId}.`);
  const tests: DiscoveredPlaywrightTest[] | undefined = plan.discoveries[input.suite];
  if (!tests) throw new Error(`The prepared plan holds no ${input.suite} discovery.`);
  return { fingerprint: group.fingerprint, runKey: group.runKey, selection: selectionOf(tests) };
}
