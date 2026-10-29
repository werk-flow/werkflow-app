import { describe, expect, test } from 'bun:test';

import { incidentPreventionProblem, recordsIncident } from './incident-record';

describe('incident record', () => {
  test('records failed acceptance runs of proven behavior only', () => {
    expect(recordsIncident({ lane: 'group', groupId: 'golden:p1-06' }, 'environment')).toBe(true);
    expect(recordsIncident({ lane: 'group', groupId: 'golden:p1-06' }, 'authoring')).toBe(false);
    expect(recordsIncident({ lane: 'group', groupId: 'audit:visual' }, 'accepted-change')).toBe(false);
    expect(recordsIncident({ lane: 'iteration', groupId: 'golden:p1-06' }, 'harness')).toBe(false);
    expect(recordsIncident({ lane: 'diagnostic', groupId: 'golden:p1-06' }, 'harness')).toBe(false);
  });

  test('refuses a prevention that names no tier', () => {
    expect(incidentPreventionProblem('Added a wait.')).toContain('must name its enforcement tier');
    expect(incidentPreventionProblem('Tier 1: the helper owns it.')).toBeNull();
    expect(incidentPreventionProblem('Tier 3: no mechanism sees a WSL restart.')).toBeNull();
    expect(incidentPreventionProblem('The provider recovered; no prevention claim.')).toBeNull();
  });
});
