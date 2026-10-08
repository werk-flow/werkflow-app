// Roadmap rules (docs/plans/phase-1/protocol.md, "Slice Status Model" and the update protocol):
// a slice row uses a status the protocol defines, an accepted slice has its progress-log
// entry, and the primary spec of an accepted slice was reviewed on or after the acceptance.

/** The status values of the protocol's slice status model. */
const SLICE_STATUSES = [
  'planned',
  'ready',
  'in_progress',
  'verification',
  'complete',
  'decision_blocked',
  'superseded',
] as const;

export type RoadmapRow = {
  line: number;
  id: string;
  status: string;
  dependencies: string[];
  specs: string;
  exitEvidence: string;
};

const ROW_START_PATTERN = /^\| `(P1-\d{2}a?)`/;
const ROW_CELL_COUNT = 6;

/**
 * Every slice row of the master index: a table row whose first cell is a backticked
 * `P1-XX` id. A row with the wrong number of cells or an unbackticked status is a problem
 * instead of a row, so a malformed row cannot drop out of the other checks silently.
 */
export function readRoadmapRows(markdown: string): { rows: RoadmapRow[]; problems: string[] } {
  const rows: RoadmapRow[] = [];
  const problems: string[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    const id = line.match(ROW_START_PATTERN)?.[1];
    if (id === undefined) return;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    const [, statusCell = '', , dependencyCell = '', specs = '', exitEvidence = ''] = cells;
    const status = statusCell.match(/^`([^`]+)`$/)?.[1];
    if (cells.length !== ROW_CELL_COUNT || status === undefined) {
      problems.push(
        `line ${index + 1}: the ${id} row needs ${ROW_CELL_COUNT} cells with a backticked status in the second`,
      );
      return;
    }
    if (!(SLICE_STATUSES as readonly string[]).includes(status)) {
      problems.push(
        `line ${index + 1}: ${id} has the status \`${status}\`, which the protocol's status model does not define (${SLICE_STATUSES.join(', ')})`,
      );
    }
    const dependencies = [...dependencyCell.matchAll(/`(P1-\d{2}a?)`/g)].flatMap((entry) => entry[1] ?? []);
    rows.push({ line: index + 1, id, status, dependencies, specs, exitEvidence });
  });
  return { rows, problems };
}

/**
 * The entries of the append-only progress log: each bold-led prose paragraph and each
 * dated table row is one entry.
 */
export function readLogEntries(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith('**') || /^\| \d{4}-\d{2}-\d{2} /.test(line));
}

/**
 * Whether the log records the acceptance of a slice: an entry links its record, or
 * names the slice and says it was accepted complete.
 */
export function logRecordsAcceptance(
  entries: readonly string[],
  sliceId: string,
  recordPath: string,
): boolean {
  const idPattern = new RegExp(`\`?${sliceId}\`?(?![a-z0-9])`);
  return entries.some(
    (entry) =>
      entry.includes(recordPath) || (idPattern.test(entry) && /accepted\W+(?:\*\*)?`?complete/i.test(entry)),
  );
}

/** The feature spec each primary-spec name of the roadmap stands for, by its leading words. */
const PRIMARY_SPEC_NAMES: readonly (readonly [RegExp, string])[] = [
  [/^(customers\/crm|crm)\b/i, 'features/customers-and-crm.md'],
  [/^jobs\b/i, 'features/jobs-and-projects.md'],
  [/^calendar\b/i, 'features/calendar-and-resource-planning.md'],
  [/^employee\b/i, 'features/employee-management.md'],
  [/^time\b/i, 'features/time-tracking.md'],
  [/^documents?\b/i, 'features/document-management.md'],
  [/^inventory\b/i, 'features/inventory.md'],
  [/^service\b/i, 'features/service-and-maintenance.md'],
  [/^commercial\b/i, 'features/commercial-and-finance.md'],
  [/^ai\b/i, 'features/ai-automations.md'],
];
const ALL_SPECS_PATTERN = /^all feature specs\b/i;

/**
 * The spec paths (relative to docs/) that the first entry of a row's spec cell names,
 * every spec for "All feature specs", or null when the name maps to no spec.
 */
export function primarySpecsOf(specCell: string, allSpecs: readonly string[]): string[] | null {
  const primary = specCell.split(';')[0]?.trim() ?? '';
  if (ALL_SPECS_PATTERN.test(primary)) return [...allSpecs];
  const spec = PRIMARY_SPEC_NAMES.find(([pattern]) => pattern.test(primary))?.[1];
  return spec === undefined ? null : [spec];
}

export type AcceptedSlice = { id: string; acceptedOn: string; primarySpecs: readonly string[] };

/**
 * A spec whose status line names a review date before the acceptance of a slice that
 * names it as primary spec: the slice changed the product, so the spec was re-read then.
 */
export function findStaleSpecReviews(
  slices: readonly AcceptedSlice[],
  reviewedOn: ReadonlyMap<string, string | null>,
): string[] {
  const problems: string[] = [];
  const latest = new Map<string, { id: string; acceptedOn: string }>();
  for (const slice of slices) {
    for (const spec of slice.primarySpecs) {
      const current = latest.get(spec);
      if (!current || slice.acceptedOn > current.acceptedOn)
        latest.set(spec, { id: slice.id, acceptedOn: slice.acceptedOn });
    }
  }
  for (const [spec, { id, acceptedOn }] of latest) {
    const reviewed = reviewedOn.get(spec);
    if (reviewed === undefined) {
      problems.push(`${id} names ${spec} as its primary spec, which does not exist`);
    } else if (reviewed === null || reviewed < acceptedOn) {
      problems.push(
        `docs/${spec} was last reviewed ${reviewed ?? 'never'}, before ${id} was accepted on ${acceptedOn}; re-read its Current Product Baseline and update the status line`,
      );
    }
  }
  return problems;
}
