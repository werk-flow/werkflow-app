import { describe, expect, test } from 'bun:test';

import {
  formatRunInventory,
  retainedWorldState,
  type RunInventoryEntry,
} from './run-inventory';

function runEntry(
  overrides: Partial<RunInventoryEntry> = {},
): RunInventoryEntry {
  return {
    runKey: 'run-1',
    status: 'passed',
    lane: 'certification',
    suite: 'golden',
    target: 'local',
    grep: null,
    world: { runId: 'world-1' },
    classification: null,
    retainedAt: null,
    cleanedAt: null,
    ...overrides,
  };
}

describe('Playwright run inventory', () => {
  test('distinguishes open, cleaned, and never-retained worlds', () => {
    expect(retainedWorldState(runEntry())).toBe('none');
    expect(
      retainedWorldState(
        runEntry({
          world: null,
          retainedAt: '2026-08-29T15:00:00.000Z',
        }),
      ),
    ).toBe('none');
    expect(
      retainedWorldState(
        runEntry({ retainedAt: '2026-08-29T16:00:00.000Z' }),
      ),
    ).toBe('open');
    expect(
      retainedWorldState(
        runEntry({
          retainedAt: '2026-08-29T16:00:00.000Z',
          cleanedAt: '2026-08-29T16:30:00.000Z',
        }),
      ),
    ).toBe('cleaned');
  });

  test('reports open run keys from the full archive and ends with the total', () => {
    const lines = formatRunInventory(
      [
        runEntry({
          runKey: 'old-open-run',
          status: 'failed_retained',
          retainedAt: '2026-08-29T16:00:00.000Z',
        }),
        runEntry({
          runKey: 'recent-cleaned-run',
          status: 'failed_retained',
          retainedAt: '2026-08-29T17:00:00.000Z',
          cleanedAt: '2026-08-29T17:30:00.000Z',
        }),
      ],
      1,
    );

    expect(lines).toContain(
      'recent-cleaned-run | failed_retained | certification/golden/local | full | world-1 | cleaned | unclassified',
    );
    expect(lines).toContain(
      '[werkflow-test] Open retained run keys: old-open-run',
    );
    expect(lines.at(-1)).toBe('[werkflow-test] Open retained worlds: 1');
  });
});
