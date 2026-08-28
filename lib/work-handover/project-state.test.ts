import { describe, expect, test } from 'bun:test';

import { resolveProjectHandoverExecutionState } from './project-state';

describe('resolveProjectHandoverExecutionState', () => {
  test('keeps the project at execution complete when all child jobs were handed over', () => {
    expect(resolveProjectHandoverExecutionState(null, null, [
      { executionState: 'handed_over', status: 'fertig' },
      { executionState: 'handed_over', status: 'fertig' },
    ])).toBe('execution_complete');
  });

  test('uses a project-owned handed-over override', () => {
    expect(resolveProjectHandoverExecutionState('handed_over', null, [
      { executionState: 'execution_complete', status: 'fertig' },
    ])).toBe('handed_over');
  });

  test('requires every child to be terminal before project execution is complete', () => {
    expect(resolveProjectHandoverExecutionState(null, null, [
      { executionState: 'handed_over', status: 'fertig' },
      { executionState: 'in_progress', status: 'in_bearbeitung' },
    ])).toBe('in_progress');
  });

  test.each([
    ['abgeschlossen', 'execution_complete'],
    ['in_bearbeitung', 'in_progress'],
    [null, 'not_started'],
  ] as const)('uses the legacy %s state for a project without children', (legacyStatus, expected) => {
    expect(resolveProjectHandoverExecutionState(null, legacyStatus, [])).toBe(expected);
  });

  test('keeps an all-cancelled project cancelled', () => {
    expect(resolveProjectHandoverExecutionState(null, null, [
      { executionState: 'cancelled', status: 'nicht_bearbeitet' },
      { executionState: 'cancelled', status: 'nicht_bearbeitet' },
    ])).toBe('cancelled');
  });

  test('treats completed and cancelled children as execution complete', () => {
    expect(resolveProjectHandoverExecutionState(null, null, [
      { executionState: 'execution_complete', status: 'fertig' },
      { executionState: 'cancelled', status: 'nicht_bearbeitet' },
    ])).toBe('execution_complete');
  });

  test('keeps an interrupted project interrupted while every other child is not started', () => {
    expect(resolveProjectHandoverExecutionState(null, null, [
      { executionState: 'interrupted', status: 'in_bearbeitung' },
      { executionState: 'not_started', status: 'nicht_bearbeitet' },
    ])).toBe('interrupted');
  });
});
