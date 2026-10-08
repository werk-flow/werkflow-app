import { describe, expect, test } from 'bun:test';

import {
  incidentPreventionProblem,
  recordsIncident,
  withIncidentEntry,
  type IncidentRecord,
} from './incident-record';

const LOG = [
  '# Browser-test incident log',
  '',
  'Status: living',
  '',
  '## Required incident record',
  '',
  'Fields.',
  '',
  '## 2026-10-04: second failed release run',
  '',
  'Older entry. Tier 2.',
  '',
].join('\n');

const RECORD: IncidentRecord = {
  runKey: '2026-10-08T050000000Z-abc123',
  groupId: 'golden:p1-06',
  target: 'local',
  groupFingerprint: '0123456789abcdef0123',
  worldId: 'world-1',
  startedAt: '2026-10-08T05:00:00.000Z',
  classification: 'harness',
  firstFailure: {
    title: 'a manager approves vacation',
    message: `\u001b[31mexpect(locator).toBeVisible() failed\u001b[39m\n\nCall log:\n  - waiting`,
  },
  rootCause: 'The step pressed Escape while the save was pending.',
  prevention: 'Tier 2: lint playwright-spec/no-raw-key-press.',
};

describe('incident record', () => {
  test('writes the run facts newest first, after the fixed sections', () => {
    const written = withIncidentEntry(LOG, RECORD);
    const entryAt = written.indexOf('## 2026-10-08: golden:p1-06 harness failure');
    expect(entryAt).toBeGreaterThan(written.indexOf('## Required incident record'));
    expect(entryAt).toBeLessThan(written.indexOf('## 2026-10-04'));
    expect(written).toContain(
      '- Run: run `2026-10-08T050000000Z-abc123`, group `golden:p1-06`, target local, fingerprint `0123456789ab`, world `world-1`.',
    );
    expect(written).toContain(
      '- Failure point: a manager approves vacation: expect(locator).toBeVisible() failed\n',
    );
    expect(written).toContain('- Prevention: Tier 2: lint playwright-spec/no-raw-key-press.');
  });

  test('a second classification of the same run replaces its entry', () => {
    const once = withIncidentEntry(LOG, RECORD);
    const twice = withIncidentEntry(once, {
      ...RECORD,
      classification: 'product',
      rootCause: 'The banner starved.',
    });
    expect(twice.match(/incident-run: 2026-10-08T050000000Z-abc123/g)).toHaveLength(1);
    expect(twice).toContain('golden:p1-06 product failure');
    expect(twice).not.toContain('pressed Escape');
    expect(twice).toContain('## 2026-10-04: second failed release run');
  });

  test('records failed acceptance runs of proven behavior only', () => {
    expect(recordsIncident({ lane: 'group', groupId: 'golden:p1-06' }, 'environment')).toBe(true);
    expect(recordsIncident({ lane: 'group', groupId: 'golden:p1-06' }, 'authoring')).toBe(false);
    expect(recordsIncident({ lane: 'group', groupId: 'audit:visual' }, 'accepted-change')).toBe(false);
    expect(recordsIncident({ lane: 'iteration', groupId: 'golden:p1-06' }, 'harness')).toBe(false);
    expect(recordsIncident({ lane: 'diagnostic', groupId: 'golden:p1-06' }, 'harness')).toBe(false);
  });

  test('refuses a prevention that names no tier, as the docs check would', () => {
    expect(incidentPreventionProblem('Added a wait.')).toContain('must name its enforcement tier');
    expect(incidentPreventionProblem('Tier 1: the helper owns it.')).toBeNull();
    expect(incidentPreventionProblem('Tier 3: no mechanism sees a WSL restart.')).toBeNull();
    expect(incidentPreventionProblem('The provider recovered; no prevention claim.')).toBeNull();
  });
});
