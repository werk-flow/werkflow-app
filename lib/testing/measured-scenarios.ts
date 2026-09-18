/**
 * Registry of measured scenarios (Step 2 performance pass). Every timed
 * browser scenario has a stable id, a version, an explicit boundary, an
 * approved budget, and the data profile it is measured against. The evidence
 * validator refuses records that disagree with this registry, so a widened
 * budget, an obsolete version, or a scenario that quietly stopped recording
 * cannot qualify a group.
 */

/** Bump when the measurement method changes so old records cannot compare. */
export const MEASUREMENT_VERSION = 3;

type ScenarioBoundary =
  | "before-submit-to-visible"
  | "opening-action-to-usable-control"
  | "navigation-to-usable-content"
  | "view-switch-to-usable-content";

/** Which data profile a scenario runs against; comparisons never cross profiles. */
type ScenarioProfile = "golden-world" | "typical";

export type MeasuredScenario = {
  id: string;
  version: number;
  boundary: ScenarioBoundary;
  budgetMs: number;
  profile: ScenarioProfile;
  /** Repository-relative spec that records the scenario. */
  file: string;
  /** Records one run must produce; more or fewer fail qualification. */
  samples: number;
  /**
   * `required`: a reviewed baseline must exist and the run must not regress.
   * `calibrating`: no baseline yet; the comparison is reported as unverified
   * and does not qualify as a passing comparison.
   */
  comparison: "required" | "calibrating";
  description: string;
};

// Every scenario is `required` again since 2026-09-18: pre-Wave-3 step 5
// recalibrated all eleven references from three samples each on the beta
// candidate build 64063ae0 (runs 2026-09-18T004206826Z-aa6651, 004348887Z-269644
// and 004630732Z-469daa), retiring the Step 3 and pre-Wave-3 transfer chain
// (decision D6). A later edit to a measurement-digest input needs a fresh
// calibration from real samples, never a transfer; `performance-references.test.ts`
// refuses a required scenario without a reference at the current digest.
export const MEASURED_SCENARIOS: readonly MeasuredScenario[] = [
  {
    id: "planning.occurrence.cross-session",
    version: 1,
    boundary: "before-submit-to-visible",
    budgetMs: 2_000,
    profile: "golden-world",
    file: "tests/audit/performance/planning-benchmark.spec.ts",
    samples: 3,
    comparison: "required",
    description: "A manager saves a planned visit; a second Büro session shows the occurrence in the month grid.",
  },
  {
    id: "calendar.month.employee-open-to-event",
    version: 1,
    boundary: "navigation-to-usable-content",
    budgetMs: 5_000,
    profile: "golden-world",
    file: "tests/audit/performance/planning-benchmark.spec.ts",
    samples: 3,
    comparison: "required",
    description: "An employee opens the fixed benchmark calendar date, switches to month, and sees an assigned event.",
  },
  {
    id: "calendar.month.admin-open-to-legacy-event",
    version: 1,
    boundary: "navigation-to-usable-content",
    budgetMs: 5_000,
    profile: "golden-world",
    file: "tests/audit/performance/planning-benchmark.spec.ts",
    samples: 3,
    comparison: "required",
    description: "An administrator opens the fixed benchmark date after creating a legacy-date job and sees its month event.",
  },
  {
    id: "calendar.day.cold-open",
    version: 1,
    boundary: "navigation-to-usable-content",
    budgetMs: 5_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "First navigation to /kalender in a session until the day view reports ready.",
  },
  {
    id: "calendar.day-to-week.uncovered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 2_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "After the shell settled, switch from the covered day to the uncovered week; the week view reports ready.",
  },
  {
    id: "calendar.week-to-day.covered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 500,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch back to the day inside the covered week; no read is required.",
  },
  {
    id: "calendar.week-to-month.uncovered",
    version: 2,
    boundary: "view-switch-to-usable-content",
    // Calibrated 2026-09-08: 1,778 to 2,435 ms across runs of one build at
    // 1,760 occurrences; the 2,000 ms hypothesis left no run-to-run headroom.
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch from the week to the month grid with 40 occurrences per day.",
  },
  {
    id: "calendar.month-next.uncovered",
    version: 2,
    boundary: "navigation-to-usable-content",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Page to the next month in the month grid.",
  },
  {
    id: "calendar.month-to-week.covered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 500,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch from the month grid to a week inside its covered window.",
  },
  {
    id: "customers.list.open",
    version: 1,
    boundary: "navigation-to-usable-content",
    budgetMs: 5_000,
    profile: "typical",
    file: "tests/audit/performance/lists.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Navigate to /kunden with 1,000 customers until the list is usable.",
  },
  {
    id: "jobs.list.open",
    version: 1,
    boundary: "navigation-to-usable-content",
    budgetMs: 5_000,
    profile: "typical",
    file: "tests/audit/performance/lists.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Navigate to /auftraege with 2,500 jobs until the list is usable and assignments render.",
  },
];

export function getMeasuredScenario(id: string): MeasuredScenario {
  const scenario = MEASURED_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) throw new Error(`Unknown measured scenario: ${id}`);
  return scenario;
}

export function scenariosForFiles(files: readonly string[]): MeasuredScenario[] {
  return MEASURED_SCENARIOS.filter((scenario) => files.includes(scenario.file));
}

export function validateMeasuredScenarios(scenarios: readonly MeasuredScenario[] = MEASURED_SCENARIOS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const scenario of scenarios) {
    if (ids.has(scenario.id)) problems.push(`Duplicate scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(scenario.id)) problems.push(`Scenario id is not a stable slug: ${scenario.id}`);
    if (!Number.isInteger(scenario.version) || scenario.version < 1) problems.push(`Scenario version must be a positive integer: ${scenario.id}`);
    if (!Number.isFinite(scenario.budgetMs) || scenario.budgetMs <= 0) problems.push(`Scenario budget must be positive: ${scenario.id}`);
    if (!Number.isInteger(scenario.samples) || scenario.samples < 1) problems.push(`Scenario samples must be a positive integer: ${scenario.id}`);
    if (!scenario.file.endsWith(".spec.ts")) problems.push(`Scenario file must be a browser spec: ${scenario.id}`);
  }
  return problems;
}
