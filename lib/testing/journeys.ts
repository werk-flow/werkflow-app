/**
 * The journeys each role repeats many times a day (docs/technical/performance.md).
 * Each one is taken from the feature specs and the user-flow catalog: the
 * product has no usage analytics, so "many times a day" is the spec's account
 * of the role's work, not a measured frequency. A journey is measured from the
 * user's action to the usable result, never from a component's mount.
 *
 * The owner's (admin) daily journeys are the office's; the admin rows add
 * what only the owner opens: the task list across the company and the
 * settings. No new wall-clock scenario was added for a journey: the measured
 * protocol identity (lib/testing/performance-context.ts) is a frozen digest
 * input and knows no new spec file, so a journey without a scenario of its own
 * is covered by its lab steps, which print the wall-clock time beside the
 * counts.
 */

import type { LabRole } from './lab-steps';

export type Journey = {
  /** Stable slug: `<area>.<object>.<verb>`. */
  readonly id: string;
  readonly role: LabRole;
  /** The user action the measurement starts at. */
  readonly start: string;
  /** The result the user can act on; the measurement ends there. */
  readonly usable: string;
  /** Flow ids of docs/product/user-flow-catalog.md. */
  readonly catalogFlows: readonly string[];
  /** Ids in MEASURED_SCENARIOS that time this journey; empty when the lab steps alone cover it. */
  readonly measuredScenarios: readonly string[];
  /** Ids in LAB_STEPS; every journey has at least one. */
  readonly labSteps: readonly string[];
};

export const JOURNEYS: readonly Journey[] = [
  {
    id: 'field.clock',
    role: 'employee',
    start: 'Tap „Arbeit starten“ or „Erfassung beenden“ in the clock sheet.',
    usable: 'The clock shows the saved running or stopped state.',
    catalogFlows: ['BASE-TIME-F01', 'P1-21-F01', 'P1-21-F04'],
    measuredScenarios: [
      'time.clock-in.visible',
      'time.clock-in.settled',
      'time.clock-out.visible',
      'time.clock-out.settled',
    ],
    labSteps: ['lab.field.clock-in', 'lab.field.idle-clocked-in', 'lab.field.clock-out'],
  },
  {
    id: 'field.job.open',
    role: 'employee',
    start: 'Open /auftraege and tap the assigned job.',
    usable: "The work pack's content is usable.",
    catalogFlows: ['P1-16-F01', 'BASE-WORK-F05'],
    measuredScenarios: [],
    labSteps: ['lab.field.cold-start', 'lab.field.job-open'],
  },
  {
    id: 'field.checklist.tick',
    role: 'employee',
    start: "Tap an instruction's done control in the work pack.",
    usable: 'The row shows the confirmed done state.',
    catalogFlows: ['P1-16-F45', 'BASE-WORK-F06'],
    measuredScenarios: [],
    labSteps: ['lab.field.checklist-tick'],
  },
  {
    id: 'field.evidence.add',
    role: 'employee',
    start: 'Save a new Arbeitsnachweis in the work pack.',
    usable: 'The saved version shows and the work pack lists the entry.',
    catalogFlows: ['P1-16-F49', 'P1-15-F29'],
    measuredScenarios: [],
    labSteps: ['lab.field.evidence-add'],
  },
  {
    id: 'office.customer.find',
    role: 'buero',
    start: 'Type a customer name into the /kunden search.',
    usable: 'The list shows the one match.',
    catalogFlows: ['BASE-CUSTOMER-F01', 'P1-01-F07'],
    measuredScenarios: ['customers.list.open'],
    labSteps: ['lab.office.customer-find'],
  },
  {
    id: 'office.job.open',
    role: 'buero',
    start: 'Click a job row on /auftraege, and go back.',
    usable: 'The job detail is usable; after going back, the list is.',
    catalogFlows: ['BASE-WORK-F08'],
    measuredScenarios: ['jobs.list.open', 'jobs.detail.open'],
    labSteps: ['lab.office.cold-start', 'lab.office.job-open', 'lab.office.job-back'],
  },
  {
    id: 'office.job.create',
    role: 'buero',
    start: 'Submit the create dialog on /auftraege.',
    usable: 'The list shows the confirmed new row.',
    catalogFlows: ['BASE-WORK-F01'],
    measuredScenarios: [],
    labSteps: ['lab.office.job-create'],
  },
  {
    id: 'office.calendar.move',
    role: 'buero',
    start: "Open a visit on the Plantafel, then release it on another person's cell.",
    usable: 'The overview shows the visit; the move is confirmed with Undo.',
    catalogFlows: ['P1-24a-F10', 'P1-24a-F15'],
    measuredScenarios: [
      'calendar.board.cold-open',
      'calendar.board.reassign.visible',
      'calendar.board.reassign.settled',
    ],
    labSteps: ['lab.office.entry-open', 'lab.office.visit-move'],
  },
  {
    id: 'office.time.approve',
    role: 'buero',
    start: '„Genehmigen“ on an open submission.',
    usable: 'The approval is confirmed and the card leaves the list.',
    catalogFlows: ['BASE-TIME-F06'],
    measuredScenarios: ['time.approval.cross-session'],
    labSteps: ['lab.office.time-approve'],
  },
  {
    id: 'admin.tasks.open',
    role: 'admin',
    start: 'Open Aufgaben from the sidebar.',
    usable: 'The task list is usable.',
    catalogFlows: ['P1-07-F01'],
    measuredScenarios: ['tasks.list.open'],
    labSteps: ['lab.admin.tasks-open'],
  },
  {
    id: 'admin.settings.open',
    role: 'admin',
    start: 'Open the employee settings (Verantwortlichkeiten) from the settings navigation.',
    usable: 'The settings form is usable.',
    catalogFlows: ['P1-05-F01'],
    measuredScenarios: [],
    labSteps: ['lab.admin.settings-open'],
  },
];
