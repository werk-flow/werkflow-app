import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const LIVE_TARGET_MS = 2_000;
// P1-22's former shell-only budget covers opening through usable options.
export const TIME_CORRECTION_READY_MS = 5_000;

const observationSchema = z.object({
  label: z.string().min(1),
  backend: z.enum(["local", "cloud"]),
  measuredMs: z.number().finite().nonnegative(),
  targetMs: z.number().finite().positive(),
  status: z.enum(["visible", "observation_failed", "mutation_failed"]),
  correctness: z.enum(["observed", "not_observed", "unconfirmed"]),
  responsiveness: z.enum(["within_target", "over_target", "unconfirmed"]),
  boundary: z.string(),
});

export type LatencyEvidenceCheck = {
  freshnessMeasurements: number;
  readinessMeasurements: number;
  problems: string[];
};

/** A caught assertion or later fast retry cannot erase earlier deadline evidence. */
export function checkLatencyEvidence(input: {
  directory: string;
  requireFreshness?: boolean;
  requireReadiness?: boolean;
}): LatencyEvidenceCheck {
  const result: LatencyEvidenceCheck = { freshnessMeasurements: 0, readinessMeasurements: 0, problems: [] };
  const archives = [
    { name: "live-latencies.ndjson", count: "freshnessMeasurements", required: input.requireFreshness, targetMs: LIVE_TARGET_MS, boundary: "before-submit-to-visible" },
    { name: "readiness-latencies.ndjson", count: "readinessMeasurements", required: input.requireReadiness, targetMs: TIME_CORRECTION_READY_MS, boundary: "opening-action-to-usable-control" },
  ] as const;
  for (const archive of archives) {
    const path = resolve(input.directory, archive.name);
    let contents: string;
    try {
      contents = existsSync(path) ? readFileSync(path, "utf8") : "";
    } catch {
      result.problems.push(`${archive.name}: evidence could not be read.`);
      continue;
    }
    const lines = contents.split(/\r?\n/).filter((line) => line.trim());
    if (archive.required && !lines.length) result.problems.push(`${archive.name}: required responsiveness evidence is missing.`);
    for (const [index, line] of lines.entries()) {
      let observation: z.infer<typeof observationSchema>;
      try { observation = observationSchema.parse(JSON.parse(line)); }
      catch {
        result.problems.push(`${archive.name}:${index + 1}: malformed or obsolete responsiveness evidence.`);
        continue;
      }
      result[archive.count] += 1;
      const reference = `${archive.name}:${index + 1} (${observation.label})`;
      if (observation.targetMs !== archive.targetMs || observation.boundary !== archive.boundary) {
        result.problems.push(`${reference}: measurement does not use the required ${archive.targetMs}ms contract and timing boundary.`);
      }
      if (observation.status !== "visible" || observation.correctness !== "observed") {
        result.problems.push(`${reference}: correctness was not confirmed; classify the original failure before accepting evidence.`);
      }
      if (observation.measuredMs > archive.targetMs || observation.responsiveness !== "within_target") {
        result.problems.push(`${reference}: responsiveness did not pass, measured ${observation.measuredMs}ms against ${archive.targetMs}ms.`);
      }
    }
  }
  return result;
}
