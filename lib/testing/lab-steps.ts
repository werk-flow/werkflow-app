/**
 * Registry of lab steps (docs/technical/performance.md). A lab step is one
 * user action of a journey (lib/testing/journeys.ts), recorded on the typical
 * profile from the action until the page is quiet again. It counts what does
 * not vary between runs: requests, route renders, round trips, React commits,
 * DOM mutations, layouts and payload bytes. The counts are compared with the
 * reviewed references in lib/testing/lab-count-references.json.
 */

/** Every count a step records, gated or not. A gated metric has a reference; the others print only. */
export const LAB_METRICS = [
  /** Every request the page started, the Realtime socket excluded. */
  'requests',
  /** Route renders the step asked for: documents, route GETs and revalidating actions, echoes excluded. */
  'routeRenders',
  /** Route refreshes the Realtime echo of the step's own write started. */
  'echoRenders',
  /** Server Action POSTs. */
  'actionRoundTrips',
  /** GETs to the background-read registry. */
  'backgroundReads',
  /** Router prefetches. */
  'prefetches',
  /** Requests the server sent to the local Supabase gateway while the step ran. */
  'backendRequests',
  /** React commits (the DevTools hook React calls on every commit). */
  'reactCommits',
  /** Components React rendered in those commits: a whole list rendered for one row shows here. */
  'componentRenders',
  /** Mutation records of one observer on the whole document. */
  'domMutations',
  /** Chromium layouts (CDP `LayoutCount`). */
  'layoutCount',
  /** Chromium style recalculations (CDP `RecalcStyleCount`). */
  'recalcStyleCount',
  /** Main-thread tasks over 50 ms. */
  'longTasks',
  /** Animation frames over 50 ms. */
  'longAnimationFrames',
] as const;

export type LabMetric = (typeof LAB_METRICS)[number];
export type LabRole = 'admin' | 'buero' | 'employee';
type LabStepKind = 'cold-load' | 'navigation' | 'mutation' | 'idle';

export type LabStep = {
  readonly id: string;
  /** Bump when the step's trigger or usable result changes meaning; old references stop applying. */
  readonly version: number;
  readonly journey: string;
  readonly role: LabRole;
  /** The lab spec whose test records the step. */
  readonly file: string;
  readonly kind: LabStepKind;
  readonly viewport: { readonly width: number; readonly height: number };
  /** CDP CPU throttling rate: 4 stands for a mid-range phone. Counts do not depend on it; long tasks do. */
  readonly cpuThrottle: 1 | 4;
  /** Absolute product budgets. A reference never exceeds them, and a run above one fails. */
  readonly budgets: Partial<Readonly<Record<LabMetric, number>>>;
  /** `required`: a reviewed reference must exist. `calibrating`: the comparison is reported only. */
  readonly comparison: 'required' | 'calibrating';
  readonly description: string;
};

export const LAB_SPEC_DIRECTORY = 'tests/audit/lab/';
const FIELD_SPEC = `${LAB_SPEC_DIRECTORY}field.spec.ts`;
const OFFICE_SPEC = `${LAB_SPEC_DIRECTORY}office.spec.ts`;
const PHONE = { width: 375, height: 812 } as const;
const LAPTOP = { width: 1440, height: 900 } as const;

/** One save renders the route once (realtime-and-caching.md, "Checklist"). */
const SAVE = { routeRenders: 1 } as const;
/** A navigation renders the destination once and saves nothing. */
const NAVIGATION = { routeRenders: 1, actionRoundTrips: 0 } as const;

function fieldStep(input: Pick<LabStep, 'id' | 'journey' | 'kind' | 'budgets' | 'description'>): LabStep {
  return {
    ...input,
    version: 1,
    role: 'employee',
    file: FIELD_SPEC,
    viewport: PHONE,
    cpuThrottle: 4,
    comparison: 'required',
  };
}

function officeStep(
  input: Pick<LabStep, 'id' | 'journey' | 'kind' | 'budgets' | 'description'> & { role?: LabRole },
): LabStep {
  const { role = 'buero', ...rest } = input;
  return {
    ...rest,
    version: 1,
    role,
    file: OFFICE_SPEC,
    viewport: LAPTOP,
    cpuThrottle: 1,
    comparison: 'required',
  };
}

export const LAB_STEPS: readonly LabStep[] = [
  fieldStep({
    id: 'lab.field.cold-start',
    journey: 'field.job.open',
    kind: 'cold-load',
    budgets: { actionRoundTrips: 0 },
    description: 'A fresh session loads /auftraege until the job list is usable and the live shell joined.',
  }),
  fieldStep({
    id: 'lab.field.job-open',
    journey: 'field.job.open',
    kind: 'navigation',
    budgets: NAVIGATION,
    description: "The field worker taps the assigned job and the work pack's content is usable.",
  }),
  fieldStep({
    id: 'lab.field.checklist-tick',
    journey: 'field.checklist.tick',
    kind: 'mutation',
    budgets: SAVE,
    description: 'The field worker ticks an instruction done and the row shows it confirmed.',
  }),
  fieldStep({
    id: 'lab.field.evidence-add',
    journey: 'field.evidence.add',
    kind: 'mutation',
    budgets: SAVE,
    description: 'The field worker saves a new Arbeitsnachweis and the work pack lists it confirmed.',
  }),
  fieldStep({
    id: 'lab.field.clock-in',
    journey: 'field.clock',
    kind: 'mutation',
    budgets: SAVE,
    description:
      'The field worker starts work in the clock sheet and the clock shows the saved running state.',
  }),
  fieldStep({
    id: 'lab.field.idle-clocked-in',
    journey: 'field.clock',
    kind: 'idle',
    budgets: { requests: 0, routeRenders: 0, reactCommits: 0, domMutations: 0, longTasks: 0 },
    description:
      'Three quiet seconds on the dashboard while the clock runs: nothing may read, render or commit.',
  }),
  fieldStep({
    id: 'lab.field.clock-out',
    journey: 'field.clock',
    kind: 'mutation',
    budgets: SAVE,
    description: 'The field worker ends the recording and the clock shows the saved stopped state.',
  }),
  officeStep({
    id: 'lab.office.cold-start',
    journey: 'office.job.open',
    kind: 'cold-load',
    budgets: { actionRoundTrips: 0 },
    description:
      'A fresh office session loads /auftraege until the job list is usable and the live shell joined.',
  }),
  officeStep({
    id: 'lab.office.job-open',
    journey: 'office.job.open',
    kind: 'navigation',
    budgets: NAVIGATION,
    description: 'The office clicks a job row and the job detail is usable.',
  }),
  officeStep({
    id: 'lab.office.job-back',
    journey: 'office.job.open',
    kind: 'navigation',
    budgets: { actionRoundTrips: 0 },
    description: 'The office goes back from the job detail and the job list is usable again.',
  }),
  officeStep({
    id: 'lab.office.customer-find',
    journey: 'office.customer.find',
    kind: 'navigation',
    budgets: { actionRoundTrips: 0 },
    description: 'The office types a customer name into the /kunden search and the list shows the one match.',
  }),
  officeStep({
    id: 'lab.office.job-create',
    journey: 'office.job.create',
    kind: 'mutation',
    budgets: SAVE,
    description: 'The office saves a new job in the create dialog and the list shows the confirmed row.',
  }),
  officeStep({
    id: 'lab.office.entry-open',
    journey: 'office.calendar.move',
    kind: 'navigation',
    budgets: { routeRenders: 0, actionRoundTrips: 0 },
    description:
      'The office opens a visit on the Plantafel and its overview is usable, from the window the board holds.',
  }),
  officeStep({
    id: 'lab.office.visit-move',
    journey: 'office.calendar.move',
    kind: 'mutation',
    budgets: {},
    description: "The office drops a visit on another person's Plantafel cell and the move is confirmed.",
  }),
  officeStep({
    id: 'lab.office.time-approve',
    journey: 'office.time.approve',
    kind: 'mutation',
    budgets: SAVE,
    description: 'The office approves an open time submission and the approval list confirms it.',
  }),
  officeStep({
    id: 'lab.admin.tasks-open',
    journey: 'admin.tasks.open',
    role: 'admin',
    kind: 'navigation',
    budgets: NAVIGATION,
    description: 'The owner opens Aufgaben from the sidebar and the task list is usable.',
  }),
  officeStep({
    id: 'lab.admin.settings-open',
    journey: 'admin.settings.open',
    role: 'admin',
    kind: 'navigation',
    budgets: NAVIGATION,
    description: 'The owner opens the employee settings from the settings navigation and the form is usable.',
  }),
];

export function isLabSpec(file: string): boolean {
  return file.startsWith(LAB_SPEC_DIRECTORY);
}

export function labStepsForFiles(files: readonly string[]): LabStep[] {
  return LAB_STEPS.filter((step) => files.includes(step.file));
}

export function getLabStep(id: string): LabStep {
  const step = LAB_STEPS.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`Unknown lab step ${id}; register it in lib/testing/lab-steps.ts.`);
  return step;
}
