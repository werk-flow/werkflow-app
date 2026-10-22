/**
 * The client pre-check of every action the server can refuse (werkflow-design,
 * "Calendar canon", "History": never let a user start a change the server
 * will refuse). Each row pairs the server's refusal codes with the client
 * predicate that predicts them, the Server Actions that perform the change,
 * and the ways a view may carry the check: import the predicate or one of its
 * wrappers, receive one of the listed props from a parent that asked it, or
 * read one of the screened background kinds, whose reader keeps only what
 * the predicate allows. The server keeps its refusal as the backstop.
 * `lib/conventions/action-prechecks.test.ts` reads this table against the
 * views and the server code.
 */

/** A named export of a repository file, path relative to the root with its extension. */
export type ExportReference = { readonly module: string; readonly exportName: string };

/**
 * Where the server owns the rule: TypeScript guards that use the predicate
 * themselves, a SQL test that asserts every refusal code the database raises,
 * or a reviewed divergence where the client predicate only approximates the
 * server rule.
 */
type ServerRule =
  | { readonly kind: 'typescript'; readonly guards: readonly ExportReference[] }
  | { readonly kind: 'sql'; readonly test: string }
  | { readonly kind: 'reviewed'; readonly reason: string };

export type ActionPrecheck = {
  readonly kind: string;
  readonly serverCodes: readonly string[];
  readonly predicate: ExportReference;
  /** Functions that call the predicate or another wrapper of the row; importing one pairs a view too. */
  readonly wrappers: readonly ExportReference[];
  readonly actions: readonly ExportReference[];
  /** Background read kinds whose reader keeps only the items the predicate allows. */
  readonly screenedReads: readonly string[];
  /** Props a view receives from a parent that asked the predicate. */
  readonly props: readonly string[];
  /** Path prefixes of the views the row governs; app/, components/ and hooks/ when absent. */
  readonly views?: readonly string[];
  readonly server: ServerRule;
  /** Reviewed view files, each with the reason it needs no own check. */
  readonly exempt: Readonly<Record<string, string>>;
};

const PLANNING_ACTIONS = 'lib/planning/actions.ts';
const TIME_ENTRY_WRITES = 'lib/time-tracking/entry-write-actions.ts';
const TIME_REVIEWS = 'lib/time-tracking/review-actions.ts';
const CORRECTION_ACTIONS = 'lib/time-corrections/actions.ts';
const CLOSED_PERIOD_DATES = 'lib/time-tracking/closed-period-dates.ts';
const RESPONSIBILITY_PREDICATE: ExportReference = {
  module: 'lib/responsibilities/resolution.ts',
  exportName: 'canHolderApproveTarget',
};
const RESPONSIBILITY_GUARD: ExportReference = {
  module: 'lib/responsibilities/server.ts',
  exportName: 'authorizeResponsibilityForTarget',
};
const CLOSED_PERIOD_PREDICATE: ExportReference = {
  module: CLOSED_PERIOD_DATES,
  exportName: 'isDateInClosedPeriod',
};
const CLOSED_ENTRY_WRAPPER: ExportReference = {
  module: CLOSED_PERIOD_DATES,
  exportName: 'isEntryInClosedPeriod',
};

export const ACTION_PRECHECKS: readonly ActionPrecheck[] = [
  {
    kind: 'planning-occurrence-change',
    serverCodes: ['started_planning_occurrence_immutable', 'started_occurrence'],
    predicate: { module: 'lib/calendar/board.ts', exportName: 'isStartedOccurrence' },
    wrappers: [{ module: 'lib/calendar/refusal-checks.ts', exportName: 'checkOccurrenceMovable' }],
    actions: [
      { module: PLANNING_ACTIONS, exportName: 'updatePlanningCalendarEntry' },
      { module: PLANNING_ACTIONS, exportName: 'setPlanningOccurrenceStatus' },
    ],
    screenedReads: [],
    props: ['locked'],
    server: { kind: 'sql', test: 'supabase/tests/planning_occurrences.sql' },
    exempt: {
      'components/kalender/mutations/use-calendar-visit-writes.ts':
        'Writes only the drops and popover commands that checkOccurrenceMovable accepted on the board, day and month surfaces and in the entry popover.',
    },
  },
  {
    kind: 'work-lifecycle-transition',
    serverCodes: ['work_transition_not_allowed', 'work_transition_not_authorized'],
    predicate: { module: 'lib/work-lifecycle/types.ts', exportName: 'getAllowedWorkTransitions' },
    wrappers: [],
    actions: [{ module: 'lib/work-lifecycle/actions.ts', exportName: 'transitionWorkExecution' }],
    screenedReads: [],
    props: ['transitions'],
    server: { kind: 'sql', test: 'supabase/tests/work_execution_boundaries.sql' },
    exempt: {},
  },
  {
    kind: 'clock-transition',
    serverCodes: [
      'time_transition_already_open',
      'time_transition_not_open',
      'time_transition_break_mode_automatic',
    ],
    predicate: { module: 'lib/time-tracking/clock-actions.ts', exportName: 'deriveClockActions' },
    wrappers: [],
    actions: [{ module: 'lib/time-tracking/segment-actions.ts', exportName: 'transitionTimeActivity' }],
    screenedReads: [],
    props: [],
    server: { kind: 'sql', test: 'supabase/tests/p1_21_time_segments.sql' },
    exempt: {
      'components/clock-state-provider.tsx':
        'Runs the transition a consumer asks for: ClockActionList and the clock button offer only what deriveClockActions derives, and TimeActivityDialog starts or switches by the live clock state.',
    },
  },
  {
    kind: 'time-entry-edit',
    serverCodes: ['period_closed'],
    predicate: CLOSED_PERIOD_PREDICATE,
    wrappers: [
      CLOSED_ENTRY_WRAPPER,
      {
        module: 'components/kalender/entry-details-permissions.ts',
        exportName: 'getEntryDetailsPermissions',
      },
    ],
    actions: [
      { module: TIME_ENTRY_WRITES, exportName: 'addManualEntry' },
      { module: TIME_ENTRY_WRITES, exportName: 'updateEntry' },
      { module: TIME_ENTRY_WRITES, exportName: 'deleteEntry' },
      { module: TIME_ENTRY_WRITES, exportName: 'deleteEntriesBatch' },
    ],
    screenedReads: [],
    props: [],
    server: {
      kind: 'typescript',
      guards: [
        { module: 'lib/time-tracking/closed-periods.ts', exportName: 'touchesClosedTimePeriod' },
        { module: 'lib/time-tracking/closed-periods.ts', exportName: 'entriesTouchClosedTimePeriod' },
      ],
    },
    exempt: {},
  },
  {
    kind: 'time-correction-submit',
    serverCodes: ['period_closed'],
    predicate: CLOSED_PERIOD_PREDICATE,
    wrappers: [CLOSED_ENTRY_WRAPPER],
    actions: [{ module: CORRECTION_ACTIONS, exportName: 'submitTimeCorrection' }],
    screenedReads: [],
    props: [],
    server: { kind: 'sql', test: 'supabase/tests/p1_23_time_accounts.sql' },
    exempt: {},
  },
  {
    kind: 'time-entry-approval',
    serverCodes: ['not_responsible', 'self_approval_not_allowed'],
    predicate: RESPONSIBILITY_PREDICATE,
    wrappers: [{ module: 'lib/time-tracking/helpers.ts', exportName: 'canApproveEntries' }],
    actions: [{ module: TIME_REVIEWS, exportName: 'reviewEntries' }],
    screenedReads: ['pending-sessions'],
    props: ['canApprove'],
    server: { kind: 'typescript', guards: [RESPONSIBILITY_GUARD] },
    exempt: {
      'components/kalender/entry-details-commands.ts':
        'The calendar entry details offer approval by the role rule of getEntryDetailsPermissions; the calendar does not read the time_approval holder yet (open backlog row).',
    },
  },
  {
    kind: 'responsibility-approval',
    serverCodes: ['not_responsible', 'self_approval_not_allowed'],
    predicate: RESPONSIBILITY_PREDICATE,
    wrappers: [],
    actions: [
      { module: CORRECTION_ACTIONS, exportName: 'reviewTimeCorrection' },
      { module: CORRECTION_ACTIONS, exportName: 'reviewTimeCorrectionsBatch' },
      { module: 'lib/vacation/actions.ts', exportName: 'decideVacationRequest' },
      { module: 'lib/vacation/actions.ts', exportName: 'cancelApprovedVacationRequest' },
      { module: 'lib/work-artifacts/actions.ts', exportName: 'recordWorkArtifactAction' },
    ],
    screenedReads: [
      'time-correction-requests',
      'pending-vacation-for-approver',
      'decidable-approved-vacation',
    ],
    props: ['canApprove'],
    server: { kind: 'typescript', guards: [RESPONSIBILITY_GUARD] },
    exempt: {},
  },
  {
    kind: 'calendar-block-correction',
    serverCodes: ['not_responsible', 'period_closed'],
    predicate: { module: 'lib/calendar/day-row-status.ts', exportName: 'canManageBlock' },
    wrappers: [],
    actions: [{ module: CORRECTION_ACTIONS, exportName: 'submitTimeCorrection' }],
    screenedReads: [],
    props: ['canManage'],
    views: ['components/kalender/'],
    server: {
      kind: 'reviewed',
      reason:
        "canManageBlock approximates the server by role: submitTimeCorrection asks authorizeResponsibilityForTarget for another person's block, and the calendar does not read the time_approval holder yet.",
    },
    exempt: {
      'components/kalender/calendar-time-correction-dialog.tsx':
        'Opens only for a block drag, which the day and month views start only for a block canManageBlock allows.',
    },
  },
  {
    kind: 'job-schedule-edit',
    serverCodes: ['job_has_several_visits'],
    predicate: { module: 'lib/jobs/visit-schedule.ts', exportName: 'jobFormEditsSchedule' },
    wrappers: [{ module: 'components/auftraege/forms/edit-job-input.ts', exportName: 'buildEditJobInput' }],
    actions: [{ module: 'lib/jobs/actions.ts', exportName: 'updateJob' }],
    screenedReads: [],
    props: [],
    server: {
      kind: 'typescript',
      guards: [{ module: 'lib/jobs/job-detail-reads.ts', exportName: 'refuseScheduleOfSeveralVisits' }],
    },
    exempt: {
      'components/auftraege/forms/create-project-form-content.tsx':
        'Links the chosen jobs to the new project: the edit names projectId only, never a schedule column.',
      'components/auftraege/forms/use-edit-project-submit.ts':
        'Links and unlinks jobs of the edited project: the edit names projectId only, never a schedule column.',
      'components/auftraege/job-detail/job-detail-relation-dialogs.tsx':
        "Changes the job's customer or project: the edit names clientId or projectId only, never a schedule column.",
      'components/auftraege/project-detail/project-detail-dialogs.tsx':
        'Adds jobs to the project: the edit names projectId only, never a schedule column.',
      'components/kalender/mutations/use-calendar-visit-writes.ts':
        'Moves a job through updateJob only while it has no planning occurrence; a job with visits moves each visit through the planning actions.',
    },
  },
];
