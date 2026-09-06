import type { PlaywrightLane } from "./run-policy";

const RUNNER_OPTIONS = ["--target", "--grep", "--reuse-run", "--rerun-grant", "--group"] as const;
export type RunnerArguments = Partial<Record<(typeof RUNNER_OPTIONS)[number], string>>;

/** All Playwright configuration stays owned by the repository. */
export function parseRunnerArguments(lane: PlaywrightLane, args: readonly string[]): RunnerArguments {
  const result: RunnerArguments = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const separator = argument.indexOf("=");
    const name = separator < 0 ? argument : argument.slice(0, separator);
    if (!(RUNNER_OPTIONS as readonly string[]).includes(name)) {
      throw new Error(`Unsupported runner argument ${name}. Use only ${RUNNER_OPTIONS.join(", ")}. Suite, retries, workers, output and configuration are repository-owned.`);
    }
    const option = name as (typeof RUNNER_OPTIONS)[number];
    if (result[option] !== undefined) throw new Error(`${name} cannot be repeated.`);
    const value = separator < 0 ? args[++index] : argument.slice(separator + 1);
    if (!value?.trim() || value.startsWith("--")) throw new Error(`${name} requires a value.`);
    result[option] = value;
  }
  if (lane === "certification" && result["--grep"]) throw new Error("Certification cannot select a subset; use a focused iteration run.");
  if (lane === "group" && (!result["--group"] || result["--grep"] || result["--reuse-run"] || result["--rerun-grant"])) throw new Error("Group acceptance requires --group with optional --target only. Selection and prerequisites come from the registry.");
  if (lane !== "group" && result["--group"]) throw new Error("--group is available only in group acceptance.");
  return result;
}
