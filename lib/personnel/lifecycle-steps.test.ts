import { describe, expect, test } from 'bun:test';

import {
  accessTransitionInputSchema,
  employmentTransitionInputSchema,
  saveRequirementInputSchema,
  type PersonnelAccessState,
  type PersonnelEmploymentState,
} from './lifecycle';
import {
  allowedAccessSteps,
  allowedEmploymentSteps,
  hasOpenAccessBlocker,
  OPEN_REQUIREMENT_STATES,
} from './lifecycle-steps';

const now = Date.parse('2026-11-10T09:00:00.000Z');
const later = '2026-11-20T09:00:00.000Z';
const earlier = '2026-11-01T09:00:00.000Z';
const today = '2026-11-10';

const access = (
  state: PersonnelAccessState,
  scheduled: { scheduledState: PersonnelAccessState; scheduledFor: string } | null = null,
) => ({
  state,
  scheduledState: scheduled?.scheduledState ?? null,
  scheduledFor: scheduled?.scheduledFor ?? null,
});
const accessSteps = (
  lifecycle: ReturnType<typeof access> | null,
  options: { isMember?: boolean; hasAccessBlocker?: boolean } = {},
) =>
  allowedAccessSteps({
    lifecycle,
    isMember: options.isMember ?? true,
    hasAccessBlocker: options.hasAccessBlocker ?? false,
    now,
  });

const employment = (
  state: PersonnelEmploymentState,
  scheduled: { scheduledState: PersonnelEmploymentState; scheduledFor: string } | null = null,
) => ({
  state,
  scheduledState: scheduled?.scheduledState ?? null,
  scheduledFor: scheduled?.scheduledFor ?? null,
});
const employmentSteps = (
  lifecycle: ReturnType<typeof employment> | null,
  dates: { entryDate?: string; exitDate?: string } = {},
) =>
  allowedEmploymentSteps({
    lifecycle,
    entryDate: dates.entryDate ?? null,
    exitDate: dates.exitDate ?? null,
    today,
  });

describe('access steps follow the current access', () => {
  test('a member without an access lifecycle has access, so no step plans or reactivates it', () => {
    expect(accessSteps(null)).toEqual(['suspend_now', 'schedule_suspension', 'end_access', 'activate_now']);
  });

  test('a person without a login can only get access planned', () => {
    expect(accessSteps(null, { isMember: false })).toEqual(['schedule_activation']);
    expect(accessSteps(access('not_configured'), { isMember: false })).toEqual(['schedule_activation']);
  });

  test('active access can be suspended, a suspension planned or the access ended, never activated again', () => {
    expect(accessSteps(access('active'))).toEqual(['suspend_now', 'schedule_suspension', 'end_access']);
  });

  test('suspended and ended access come back through reactivation, never through another suspension', () => {
    expect(accessSteps(access('suspended'))).toEqual(['reactivate', 'schedule_activation', 'end_access']);
    expect(accessSteps(access('ended'))).toEqual(['reactivate', 'schedule_activation']);
  });

  test('reactivation and immediate activation need a membership', () => {
    expect(accessSteps(access('ended'), { isMember: false })).toEqual(['schedule_activation']);
    expect(accessSteps(access('suspended'), { isMember: false })).toEqual([
      'schedule_activation',
      'end_access',
    ]);
  });

  test('a planned change can be withdrawn only while it is still ahead', () => {
    expect(accessSteps(access('active', { scheduledState: 'suspended', scheduledFor: later }))).toEqual([
      'suspend_now',
      'schedule_suspension',
      'end_access',
      'cancel_scheduled',
    ]);
    expect(accessSteps(access('scheduled', { scheduledState: 'active', scheduledFor: later }))).toEqual([
      'activate_now',
      'schedule_activation',
      'end_access',
      'cancel_scheduled',
    ]);
  });

  test('a due planned change counts as taken and cannot be withdrawn', () => {
    expect(accessSteps(access('active', { scheduledState: 'suspended', scheduledFor: earlier }))).toEqual([
      'reactivate',
      'schedule_activation',
      'end_access',
    ]);
  });

  test('a due activation held back by an open blocker stays planned and can be withdrawn', () => {
    expect(
      accessSteps(access('scheduled', { scheduledState: 'active', scheduledFor: earlier }), {
        hasAccessBlocker: true,
      }),
    ).toEqual(['activate_now', 'schedule_activation', 'end_access', 'cancel_scheduled']);
  });

  test('every access state offers at least one step, with or without a membership', () => {
    const states = ['not_configured', 'scheduled', 'active', 'suspended', 'ended'] as const;
    for (const state of states) {
      for (const isMember of [true, false]) {
        expect(
          accessSteps(access(state), { isMember }).length,
          `${state}, member ${isMember}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  test('every access step is offered in some state', () => {
    const offered = new Set(
      [null, ...(['not_configured', 'active', 'suspended', 'ended'] as const).map((state) => access(state))]
        .flatMap((lifecycle) => accessSteps(lifecycle))
        .concat(accessSteps(access('scheduled', { scheduledState: 'active', scheduledFor: later }))),
    );
    expect([...offered].sort()).toEqual([...accessTransitionInputSchema.shape.transitionKind.options].sort());
  });
});

describe('employment steps follow the current employment', () => {
  test('without a lifecycle the entry and exit dates decide the state', () => {
    expect(employmentSteps(null)).toEqual(['record_notice', 'plan_exit', 'exit', 'mark_inactive']);
    expect(employmentSteps(null, { entryDate: '2026-12-01' })).toEqual(['plan_start', 'start']);
    expect(employmentSteps(null, { exitDate: today })).toEqual(['reactivate', 'reverse', 'plan_start']);
  });

  test('an active person can get notice, a planned or recorded exit, or be set inactive', () => {
    expect(employmentSteps(employment('active'))).toEqual([
      'record_notice',
      'plan_exit',
      'exit',
      'mark_inactive',
    ]);
  });

  test('a person under notice can have the exit planned, recorded or the notice reversed, never noticed again', () => {
    expect(employmentSteps(employment('notice'))).toEqual(['plan_exit', 'exit', 'mark_inactive', 'reverse']);
  });

  test('an inactive person comes back through reactivation or leaves', () => {
    expect(employmentSteps(employment('inactive'))).toEqual(['reactivate', 'plan_exit', 'exit']);
  });

  test('an exited person can return, have the exit corrected or a new entry planned, never exit again', () => {
    expect(employmentSteps(employment('exited'))).toEqual(['reactivate', 'reverse', 'plan_start']);
  });

  test('a planned person starts or has the start moved', () => {
    expect(employmentSteps(employment('planned'))).toEqual(['plan_start', 'start']);
  });

  test('a planned step can be withdrawn only while its date is still ahead', () => {
    expect(
      employmentSteps(employment('notice', { scheduledState: 'exited', scheduledFor: '2026-11-11' })),
    ).toEqual(['plan_exit', 'exit', 'mark_inactive', 'reverse', 'cancel_scheduled']);
    expect(employmentSteps(employment('notice', { scheduledState: 'exited', scheduledFor: today }))).toEqual([
      'reactivate',
      'reverse',
      'plan_start',
    ]);
  });

  test('every employment step is offered in some state', () => {
    const states = ['planned', 'active', 'notice', 'inactive', 'exited'] as const;
    const offered = new Set(
      states
        .flatMap((state) => employmentSteps(employment(state)))
        .concat(
          employmentSteps(employment('planned', { scheduledState: 'active', scheduledFor: '2026-12-01' })),
        ),
    );
    expect([...offered].sort()).toEqual(
      [...employmentTransitionInputSchema.shape.transitionKind.options].sort(),
    );
  });
});

describe('access blockers', () => {
  test('a blocking requirement holds access back until it is fulfilled, waived or cancelled', () => {
    const open = new Set<string>(OPEN_REQUIREMENT_STATES);
    const settled = saveRequirementInputSchema.shape.state.options.filter((state) => !open.has(state));
    expect(settled.sort()).toEqual(['cancelled', 'fulfilled', 'waived']);
    for (const state of OPEN_REQUIREMENT_STATES) {
      expect(hasOpenAccessBlocker([{ blocksAccess: true, state }]), state).toBe(true);
      expect(hasOpenAccessBlocker([{ blocksAccess: false, state }]), state).toBe(false);
    }
    for (const state of settled)
      expect(hasOpenAccessBlocker([{ blocksAccess: true, state }]), state).toBe(false);
  });
});
