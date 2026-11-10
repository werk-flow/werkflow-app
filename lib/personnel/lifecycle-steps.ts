import type {
  PersonnelAccessState,
  PersonnelAccessTransitionKind,
  PersonnelEmploymentState,
  PersonnelEmploymentTransitionKind,
  PersonnelRequirementState,
} from './lifecycle';

// The access and employment steps that fit a person's current state, in the
// order the dialogs offer them; the first is the dialog's preselected step.
// The view offers them and the transition actions refuse any other step
// (lifecycle-step-reads.ts). The database functions keep their own refusals
// (supabase/migrations/20260902042103_add_p1_24_people_lifecycle_rpcs.sql)
// as the backstop.

type ScheduledLifecycle<State> = {
  state: State;
  scheduledState: State | null;
  scheduledFor: string | null;
};

/**
 * Where a person's access stands for choosing a step. `uncontrolled` is a
 * member without an access lifecycle: the database treats their access as
 * active, and „Jetzt aktivieren“ puts it under the lifecycle.
 */
type AccessPosition = PersonnelAccessState | 'uncontrolled';

const ACCESS_STEPS: Record<AccessPosition, readonly PersonnelAccessTransitionKind[]> = {
  not_configured: ['schedule_activation', 'activate_now'],
  uncontrolled: ['suspend_now', 'schedule_suspension', 'end_access', 'activate_now'],
  scheduled: ['activate_now', 'schedule_activation', 'end_access'],
  active: ['suspend_now', 'schedule_suspension', 'end_access'],
  suspended: ['reactivate', 'schedule_activation', 'end_access'],
  ended: ['reactivate', 'schedule_activation'],
};

/** Steps the database refuses without a membership in the organization (`membership_required`). */
const MEMBER_ONLY_ACCESS_STEPS: ReadonlySet<PersonnelAccessTransitionKind> = new Set([
  'activate_now',
  'reactivate',
]);

const EMPLOYMENT_STEPS: Record<PersonnelEmploymentState, readonly PersonnelEmploymentTransitionKind[]> = {
  planned: ['plan_start', 'start'],
  active: ['record_notice', 'plan_exit', 'exit', 'mark_inactive'],
  notice: ['plan_exit', 'exit', 'mark_inactive', 'reverse'],
  inactive: ['reactivate', 'plan_exit', 'exit'],
  exited: ['reactivate', 'reverse', 'plan_start'],
};

/** Requirement states that still hold back access; `access_requirements_incomplete` counts all but fulfilled, waived and cancelled. */
export const OPEN_REQUIREMENT_STATES = [
  'missing',
  'pending',
  'blocked',
] as const satisfies readonly PersonnelRequirementState[];

/** Whether an onboarding requirement that blocks access is still open. */
export function hasOpenAccessBlocker(
  requirements: ReadonlyArray<{ blocksAccess: boolean; state: PersonnelRequirementState }>,
): boolean {
  const open: ReadonlySet<PersonnelRequirementState> = new Set(OPEN_REQUIREMENT_STATES);
  return requirements.some((requirement) => requirement.blocksAccess && open.has(requirement.state));
}

function accessPosition(input: {
  lifecycle: ScheduledLifecycle<PersonnelAccessState> | null;
  isMember: boolean;
  hasAccessBlocker: boolean;
  now: number;
}): { position: AccessPosition; canWithdraw: boolean } {
  const { lifecycle } = input;
  if (!lifecycle) return { position: input.isMember ? 'uncontrolled' : 'not_configured', canWithdraw: false };
  const { scheduledState, scheduledFor } = lifecycle;
  if (!scheduledState || !scheduledFor) return { position: lifecycle.state, canWithdraw: false };
  if (Date.parse(scheduledFor) > input.now) return { position: lifecycle.state, canWithdraw: true };
  // A due activation that an open blocker holds back stays planned and can still be withdrawn.
  if (scheduledState === 'active' && input.hasAccessBlocker)
    return { position: 'scheduled', canWithdraw: true };
  return { position: scheduledState, canWithdraw: false };
}

/** The access steps that fit the person's current access, at the instant `now`. */
export function allowedAccessSteps(input: {
  lifecycle: ScheduledLifecycle<PersonnelAccessState> | null;
  isMember: boolean;
  hasAccessBlocker: boolean;
  now: number;
}): PersonnelAccessTransitionKind[] {
  const { position, canWithdraw } = accessPosition(input);
  const steps = ACCESS_STEPS[position].filter(
    (step) => input.isMember || !MEMBER_ONLY_ACCESS_STEPS.has(step),
  );
  return canWithdraw ? [...steps, 'cancel_scheduled'] : steps;
}

/**
 * The employment state the database function starts from: a due planned step
 * counts as taken, and without a lifecycle the entry and exit dates decide.
 */
function employmentPosition(input: {
  lifecycle: ScheduledLifecycle<PersonnelEmploymentState> | null;
  entryDate: string | null;
  exitDate: string | null;
  today: string;
}): { position: PersonnelEmploymentState; canWithdraw: boolean } {
  const { lifecycle, entryDate, exitDate, today } = input;
  if (!lifecycle) {
    if (entryDate && entryDate > today) return { position: 'planned', canWithdraw: false };
    if (exitDate && exitDate <= today) return { position: 'exited', canWithdraw: false };
    return { position: 'active', canWithdraw: false };
  }
  const { scheduledState, scheduledFor } = lifecycle;
  if (!scheduledState || !scheduledFor) return { position: lifecycle.state, canWithdraw: false };
  if (scheduledFor > today) return { position: lifecycle.state, canWithdraw: true };
  return { position: scheduledState, canWithdraw: false };
}

/** The employment steps that fit the person's current employment on the Berlin date `today`. */
export function allowedEmploymentSteps(input: {
  lifecycle: ScheduledLifecycle<PersonnelEmploymentState> | null;
  entryDate: string | null;
  exitDate: string | null;
  today: string;
}): PersonnelEmploymentTransitionKind[] {
  const { position, canWithdraw } = employmentPosition(input);
  const steps = [...EMPLOYMENT_STEPS[position]];
  return canWithdraw ? [...steps, 'cancel_scheduled'] : steps;
}

/** The name of each access step, in the dialog and the Verlauf. */
export const ACCESS_STEP_LABELS: Record<PersonnelAccessTransitionKind, string> = {
  schedule_activation: 'Zugang planen',
  activate_now: 'Jetzt aktivieren',
  suspend_now: 'Sofort sperren',
  schedule_suspension: 'Sperre planen',
  cancel_scheduled: 'Planung zurücknehmen',
  reactivate: 'Reaktivieren',
  end_access: 'Zugang beenden',
};

/** The name of each employment step, in the dialog and the Verlauf. */
export const EMPLOYMENT_STEP_LABELS: Record<PersonnelEmploymentTransitionKind, string> = {
  plan_start: 'Eintritt planen',
  start: 'Beschäftigung starten',
  record_notice: 'Austritt vormerken',
  plan_exit: 'Austritt planen',
  mark_inactive: 'Inaktiv setzen',
  exit: 'Austritt festhalten',
  cancel_scheduled: 'Planung zurücknehmen',
  reverse: 'Übergang rückgängig machen',
  reactivate: 'Beschäftigung reaktivieren',
};
