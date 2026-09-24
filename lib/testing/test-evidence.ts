import { relative } from "node:path";

export type TestOutcomeEvidence = {
  id: string;
  status: "passed" | "failed" | "skipped" | "timedOut" | "interrupted";
  durationMilliseconds: number;
};

export type DiscoveredTest = { id: string; requiresTestIds: string[] };

export function resolveTestPrerequisites(tests: readonly {
  id: string;
  file: string;
  title: string;
  annotations: readonly { type: string; description?: string | undefined }[];
}[]): DiscoveredTest[] {
  return tests.map((test, testIndex) => {
    const required = new Set<string>();
    for (const annotation of test.annotations) {
      if (!['requires-test', 'requires-file'].includes(annotation.type)) continue;
      const matches = tests.filter((candidate) => annotation.type === 'requires-test'
        ? candidate.file === test.file && candidate.title === annotation.description
        : candidate.file === annotation.description);
      if (matches.length === 0 || (annotation.type === 'requires-test' && matches.length !== 1)) throw new Error(`Test ${test.id} declares an unknown or ambiguous ${annotation.type} prerequisite: ${annotation.description ?? '(missing)'}.`);
      for (const candidate of matches) {
        if (candidate.id === test.id) throw new Error(`Test ${test.id} cannot require itself.`);
        if (tests.indexOf(candidate) >= testIndex) throw new Error(`Test ${test.id} requires a producer that executes later: ${candidate.id}. Order the declared stages before running.`);
        required.add(candidate.id);
      }
    }
    return { id: test.id, requiresTestIds: [...required] };
  });
}

export function validateDeclaredPrerequisites(input: { selectedTestIds: readonly string[]; tests: readonly DiscoveredTest[] }): string[] {
  const selected = new Set(input.selectedTestIds);
  return input.tests.filter((test) => selected.has(test.id)).flatMap((test) => test.requiresTestIds.filter((required) => !selected.has(required)).map((required) => `${test.id} requires ${required}. Include its declared producer in the focused selection.`));
}

/** Stable across line edits. File and complete describe/title ancestry own identity. */
export function browserTestIdentity(input: {
  repositoryRoot: string;
  file: string;
  titles: readonly string[];
}): string {
  return [relative(input.repositoryRoot, input.file).replaceAll("\\", "/"), ...input.titles].join(" › ");
}

export function validateExecutedSelection(input: {
  selectedTestIds: readonly string[];
  outcomes: readonly TestOutcomeEvidence[];
  candidateBefore?: string;
  candidateAfter?: string;
}): string[] {
  const selected = new Set(input.selectedTestIds);
  const executed = new Set(input.outcomes.map((outcome) => outcome.id));
  const errors: string[] = [];
  if (selected.size === 0 || selected.size !== input.selectedTestIds.length) errors.push("Discovery must select a nonempty set of unique test identities.");
  if (executed.size !== input.outcomes.length) errors.push("Repeated test executions cannot certify a run.");
  if (selected.size !== executed.size || [...selected].some((id) => !executed.has(id))) errors.push("Executed test identities do not equal the discovered selection.");
  if (input.outcomes.some((outcome) => outcome.status !== "passed")) errors.push("Every selected test must pass without skips or retries.");
  if (input.candidateBefore !== input.candidateAfter) errors.push(BROWSER_INPUT_DRIFT_MESSAGE);
  return errors;
}

/** The execution-evidence failure a browser run records when an input changed while it ran. */
export const BROWSER_INPUT_DRIFT_MESSAGE = "Application, test or environment inputs changed during the browser run; this attempt cannot certify the candidate.";

export type BackendProvenance = {
  suite: "golden" | "audit" | "canary";
  target: "local" | "cloud";
  backendOrigin: string;
  r2Bucket: string;
  storageEndpoint: string | null;
};

export function backendOriginFromUrl(value: string | undefined): string {
  if (!value?.trim()) return 'missing';
  try {
    const parsed = new URL(value.trim());
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : 'invalid';
  } catch { return 'invalid'; }
}

export function validateDiagnosticProvenance(
  recorded: BackendProvenance | undefined,
  requested: BackendProvenance,
): string[] {
  if (!recorded) return ["This legacy retained run has no verified backend provenance. It cannot be replayed; inspect its archived evidence and create a fresh focused world."];
  if ([recorded.backendOrigin, requested.backendOrigin].some((origin) => ['missing', 'invalid'].includes(backendOriginFromUrl(origin)))) return ['Retained diagnostics require valid HTTP(S) backend origins for both runs. Configure the recorded backend before replay.'];
  return (Object.keys(requested) as Array<keyof BackendProvenance>)
    .filter((key) => recorded[key] !== requested[key])
    .map((key) => `Retained diagnostic ${key} does not match this run. Restore the recorded environment and suite before replay.`);
}
