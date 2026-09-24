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
  | "view-switch-to-usable-content"
  /** A pointer release until the optimistic result is on screen (P1-24a). */
  | "interaction-to-visible-change"
  /** A pointer release until the server confirmed the change (P1-24a). */
  | "interaction-to-settled";

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
  // The calendar of P1-24a: a manager lands on the Plantafel (one week), and
  // every view switch, horizon change and drop is measured on the typical
  // profile (10 people, 40 visits per day).
  {
    id: "calendar.board.cold-open",
    version: 1,
    boundary: "navigation-to-usable-content",
    budgetMs: 5_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "First navigation to /kalender in a session until the one-week Plantafel reports ready.",
  },
  {
    id: "calendar.board.reassign.visible",
    version: 1,
    boundary: "interaction-to-visible-change",
    budgetMs: 250,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Releasing a visit on another person's cell until the card is drawn in that row, before the server answers.",
  },
  {
    id: "calendar.board.reassign.settled",
    version: 1,
    boundary: "interaction-to-settled",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Releasing a visit on another person's cell until the confirmed banner with Undo appears.",
  },
  {
    id: "calendar.board-to-day.covered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 500,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch from the covered week to its day; no read is required.",
  },
  {
    id: "calendar.day.resize.settled",
    version: 1,
    boundary: "interaction-to-settled",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Releasing a visit's end handle in the day view until the confirmed banner appears.",
  },
  {
    id: "calendar.day-to-board.covered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 500,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch back from the day to the covered one-week Plantafel.",
  },
  {
    id: "calendar.board.six-weeks",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Widen the Plantafel from one to six weeks (about 1,700 visits) until the board reports ready.",
  },
  {
    id: "calendar.board-to-month.uncovered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch from the one-week Plantafel to the month grid with 40 visits per day.",
  },
  {
    id: "calendar.month.move.visible",
    version: 1,
    boundary: "interaction-to-visible-change",
    budgetMs: 250,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Releasing a visit on the next day's month cell until the card is drawn there, before the server answers.",
  },
  {
    id: "calendar.month.move.settled",
    version: 1,
    boundary: "interaction-to-settled",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Releasing a visit on the next day's month cell until the confirmed banner appears.",
  },
  {
    id: "calendar.month-next.uncovered",
    version: 3,
    boundary: "navigation-to-usable-content",
    budgetMs: 3_000,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Page to the next month in the month grid.",
  },
  {
    id: "calendar.month-to-board.covered",
    version: 1,
    boundary: "view-switch-to-usable-content",
    budgetMs: 500,
    profile: "typical",
    file: "tests/audit/performance/calendar.spec.ts",
    samples: 3,
    comparison: "required",
    description: "Switch from the month grid to a Plantafel week inside its covered window.",
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
