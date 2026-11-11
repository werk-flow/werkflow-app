import { describe, expect, test } from 'bun:test';

import { lifecycleTransitionLines } from './lifecycle-history';

describe('a Verlauf entry of a lifecycle transition says what changed and why', () => {
  test('an ended access names the step, the new state and the reason', () => {
    expect(
      lifecycleTransitionLines({
        eventType: 'access_transition',
        eventPayload: {
          transitionKind: 'end_access',
          fromState: 'active',
          toState: 'ended',
          effectiveAt: '2026-11-10T09:00:00.000Z',
          lifecycleVersion: 3,
          reason: '  Austritt zum Monatsende ',
        },
      }),
    ).toEqual([
      { label: 'Übergang', text: 'Zugang beenden' },
      { label: 'Zugang', text: 'Aktiv → Beendet' },
      { label: 'Grund', text: 'Austritt zum Monatsende' },
    ]);
  });

  test('a planned suspension names when it takes effect', () => {
    expect(
      lifecycleTransitionLines({
        eventType: 'access_transition',
        eventPayload: {
          transitionKind: 'schedule_suspension',
          fromState: 'active',
          toState: 'suspended',
          effectiveAt: '2026-12-01T07:00:00.000Z',
          reason: 'Elternzeit',
        },
      }),
    ).toEqual([
      { label: 'Übergang', text: 'Sperre planen' },
      { label: 'Zugang', text: 'Aktiv → Gesperrt' },
      { label: 'Wirksam ab', text: '01.12.2026, 08:00' },
      { label: 'Grund', text: 'Elternzeit' },
    ]);
  });

  test('a recorded exit names the new employment state, its date and the reason', () => {
    expect(
      lifecycleTransitionLines({
        eventType: 'employment_transition',
        eventPayload: {
          transitionKind: 'exit',
          fromState: 'notice',
          toState: 'exited',
          effectiveOn: '2026-10-31',
          reason: 'Eigene Kündigung',
          unresolvedWork: [],
        },
      }),
    ).toEqual([
      { label: 'Übergang', text: 'Austritt festhalten' },
      { label: 'Beschäftigung', text: 'Austritt vorgemerkt → Ausgeschieden' },
      { label: 'Wirksam ab', text: '31.10.2026' },
      { label: 'Grund', text: 'Eigene Kündigung' },
    ]);
  });

  test('a withdrawn plan keeps the state and names no date', () => {
    expect(
      lifecycleTransitionLines({
        eventType: 'employment_transition',
        eventPayload: {
          transitionKind: 'cancel_scheduled',
          fromState: 'notice',
          toState: 'notice',
          effectiveOn: '2026-11-10',
          reason: 'Austritt verschoben',
        },
      }),
    ).toEqual([
      { label: 'Übergang', text: 'Planung zurücknehmen' },
      { label: 'Beschäftigung', text: 'Austritt vorgemerkt' },
      { label: 'Grund', text: 'Austritt verschoben' },
    ]);
  });

  test('an unknown code or a missing fact is left out, never shown raw', () => {
    expect(
      lifecycleTransitionLines({
        eventType: 'access_transition',
        eventPayload: { transitionKind: 'teleport', toState: 'gone', reason: '' },
      }),
    ).toEqual([]);
  });

  test('a malformed date is left out and the other facts stay', () => {
    expect(
      lifecycleTransitionLines({
        eventType: 'employment_transition',
        eventPayload: {
          transitionKind: 'exit',
          toState: 'exited',
          effectiveOn: 'not-a-date',
          reason: 'Austritt',
        },
      }),
    ).toEqual([
      { label: 'Übergang', text: 'Austritt festhalten' },
      { label: 'Beschäftigung', text: 'Ausgeschieden' },
      { label: 'Grund', text: 'Austritt' },
    ]);
    expect(
      lifecycleTransitionLines({
        eventType: 'access_transition',
        eventPayload: { transitionKind: 'schedule_suspension', toState: 'suspended', effectiveAt: 'später' },
      }),
    ).toEqual([
      { label: 'Übergang', text: 'Sperre planen' },
      { label: 'Zugang', text: 'Gesperrt' },
    ]);
  });

  test('other events get no transition lines', () => {
    expect(
      lifecycleTransitionLines({ eventType: 'master_data_updated', eventPayload: { reason: 'x' } }),
    ).toEqual([]);
  });
});
