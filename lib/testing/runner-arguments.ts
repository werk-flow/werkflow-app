import type { PlaywrightLane } from "./run-policy";

const RUNNER_OPTIONS = ["--target", "--grep", "--reuse-run", "--group"] as const;
export type RunnerArguments = Partial<Record<(typeof RUNNER_OPTIONS)[number], string>>;

/** All Playwright configuration stays owned by the repository. */
export function parseRunnerArguments(lane: PlaywrightLane, args: readonly string[]): RunnerArguments {
  const result: RunnerArguments = {};
  const remaining = args.values();
  for (const argument of remaining) {
    const separator = argument.indexOf("=");
    const name = separator < 0 ? argument : argument.slice(0, separator);
    if (!(RUNNER_OPTIONS as readonly string[]).includes(name)) {
      throw new Error(`Unsupported runner argument ${name}. Use only ${RUNNER_OPTIONS.join(", ")}. Suite, retries, workers, output and configuration are repository-owned.`);
    }
    const option = name as (typeof RUNNER_OPTIONS)[number];
    if (result[option] !== undefined) throw new Error(`${name} cannot be repeated.`);
    const value = separator < 0 ? remaining.next().value : argument.slice(separator + 1);
    if (!value?.trim() || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    result[option] = value;
  }
  if (lane === "group" && (!result["--group"] || result["--grep"] || result["--reuse-run"])) throw new Error("Group acceptance requires --group with optional --target only. Selection and prerequisites come from the registry.");
  if (lane !== "group" && result["--group"]) throw new Error("--group is available only in group acceptance.");
  return result;
}
