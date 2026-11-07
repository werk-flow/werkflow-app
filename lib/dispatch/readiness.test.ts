import { describe, expect, test } from 'bun:test';

import { composeReadiness, type ReadinessFacts } from './readiness';
import type { PlanningConflict } from '@/lib/planning/types';

function assessed(conflicts: PlanningConflict[]): ReadinessFacts['planning'] {
  return { state: 'assessed', localDate: '2026-11-11', conflicts };
}

function facts(overrides: Partial<ReadinessFacts>): ReadinessFacts {
  return {
    planning: assessed([]),
    site: { known: true, name: 'Hauptgebäude', accessNotes: 'Schlüssel im Büro' },
    travelNotes: [],
    material: { state: 'no_demand' },
    ...overrides,
  };
}

function conflict(kind: PlanningConflict['kind'], message = `Konflikt: ${kind}`): PlanningConflict {
  return {
    kind,
    severity: 'warning',
    employeeRecordId: 'record-1',
    localDate: '2026-09-07',
    message,
    details: {},
  };
}

function dimension(result: ReturnType<typeof composeReadiness>, key: string) {
  const found = result.dimensions.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing readiness dimension: ${key}`);
  return found;
}

describe('readiness composition', () => {
  test('capacity and qualification conflicts land in their own dimensions', () => {
    const result = composeReadiness(
      facts({
        planning: assessed([conflict('overlap'), conflict('qualification')]),
      }),
    );
    expect(dimension(result, 'capacity').state).toBe('warning');
    expect(dimension(result, 'capacity').details).toEqual(['Konflikt: overlap']);
    expect(dimension(result, 'qualification').state).toBe('warning');
    expect(dimension(result, 'qualification').details).toEqual(['Konflikt: qualification']);
  });

  test('a visit without conflicts is met and names its date', () => {
    const result = composeReadiness(facts({}));
    expect(dimension(result, 'capacity').state).toBe('ok');
    expect(dimension(result, 'capacity').details).toEqual(['Keine Konflikte am 11.11.2026.']);
    expect(result.unplannedReason).toBeNull();
  });

  test('nobody assigned: capacity and qualifications are not assessed, never met', () => {
    const result = composeReadiness(facts({ planning: { state: 'no_assignees' } }));
    for (const key of ['capacity', 'qualification']) {
      expect(dimension(result, key).state).toBe('unknown');
      expect(dimension(result, key).details).toEqual(['Niemand zugewiesen.']);
    }
    expect(result.unplannedReason).toBe('no_assignees');
  });

  test('no date: capacity and qualifications are not assessed, never met', () => {
    const result = composeReadiness(facts({ planning: { state: 'no_visit' } }));
    for (const key of ['capacity', 'qualification']) {
      expect(dimension(result, key).state).toBe('unknown');
      expect(dimension(result, key).details).toEqual(['Kein Termin geplant.']);
    }
    expect(result.unplannedReason).toBe('no_visit');
  });

  test("a field worker's readiness leaves people to the office, never met", () => {
    const result = composeReadiness(facts({ planning: { state: 'office_only' } }));
    for (const key of ['capacity', 'qualification']) {
      expect(dimension(result, key).state).toBe('unknown');
      expect(dimension(result, key).details).toEqual(['Prüft das Büro bei der Einplanung.']);
    }
    expect(result.unplannedReason).toBeNull();
  });

  test('approved vacation and an exited person warn on capacity, each with the person named', () => {
    const result = composeReadiness(
      facts({
        planning: assessed([
          {
            ...conflict('approved_absence', 'Für diesen Zeitraum liegt eine genehmigte Abwesenheit vor.'),
            employeeName: 'Mehmet Aydın',
          },
          {
            ...conflict('outside_employment', 'Der Termin liegt nach dem Austritt dieser Person.'),
            employeeName: 'Erik Lindner',
          },
        ]),
      }),
    );
    expect(dimension(result, 'capacity').state).toBe('warning');
    expect(dimension(result, 'capacity').details).toEqual([
      'Mehmet Aydın: Für diesen Zeitraum liegt eine genehmigte Abwesenheit vor.',
      'Erik Lindner: Der Termin liegt nach dem Austritt dieser Person.',
    ]);
    expect(dimension(result, 'qualification').state).toBe('ok');
  });

  test('missing site is a visible unknown, never converted into readiness', () => {
    const result = composeReadiness(facts({ site: { known: false, reason: 'missing' } }));
    expect(dimension(result, 'site').state).toBe('unknown');
    expect(dimension(result, 'site').details).toEqual(['Kein Einsatzort hinterlegt.']);
  });

  test('a failed site lookup stays distinguishable from a missing site', () => {
    const result = composeReadiness(facts({ site: { known: false, reason: 'load_failed' } }));
    expect(dimension(result, 'site').state).toBe('unknown');
    expect(dimension(result, 'site').details).toEqual(['Einsatzort konnte nicht geladen werden.']);
  });

  test('travel warns only on explicit zero-gap facts and is otherwise "nicht bewertet"', () => {
    const quiet = composeReadiness(facts({}));
    expect(dimension(quiet, 'travel').state).toBe('unknown');
    expect(dimension(quiet, 'travel').details).toEqual(['Fahrzeit nicht bewertet.']);

    const warned = composeReadiness(
      facts({
        travelNotes: [
          {
            employeeRecordId: 'record-1',
            employeeName: 'Emil',
            localDate: '2026-09-07',
            kind: 'no_gap_different_sites',
            gapMinutes: 0,
            previousTitle: 'Besuch A',
            nextTitle: 'Besuch B',
          },
        ],
      }),
    );
    expect(dimension(warned, 'travel').state).toBe('warning');
  });

  test('material demand is labeled "nicht reserviert" and warns on shortfall only', () => {
    const covered = composeReadiness(
      facts({
        material: {
          state: 'demand',
          lines: [
            {
              itemName: 'Kupferrohr',
              plannedQuantity: 5,
              takenQuantity: 0,
              availableQuantity: 20,
            },
          ],
        },
      }),
    );
    expect(dimension(covered, 'material').state).toBe('ok');
    expect(dimension(covered, 'material').label).toContain('nicht reserviert');
    expect(dimension(covered, 'material').details[0]).toContain('nicht reserviert');

    const exactCover = composeReadiness(
      facts({
        material: {
          state: 'demand',
          lines: [
            {
              itemName: 'Kupferrohr',
              plannedQuantity: 25,
              takenQuantity: 5,
              availableQuantity: 20,
            },
          ],
        },
      }),
    );
    expect(dimension(exactCover, 'material').state).toBe('ok');

    const short = composeReadiness(
      facts({
        material: {
          state: 'demand',
          lines: [
            {
              itemName: 'Kupferrohr',
              plannedQuantity: 30,
              takenQuantity: 5,
              availableQuantity: 20,
            },
          ],
        },
      }),
    );
    expect(dimension(short, 'material').state).toBe('warning');
  });

  test('failed material loading is unknown, not zero demand', () => {
    const result = composeReadiness(facts({ material: { state: 'unknown' } }));
    expect(dimension(result, 'material').state).toBe('unknown');
  });

  test('tools are never assessed in this slice — always the labeled unknown', () => {
    const result = composeReadiness(facts({}));
    expect(dimension(result, 'tools').state).toBe('unknown');
    expect(dimension(result, 'tools').details).toEqual(['Werkzeugverfügbarkeit nicht bewertet.']);
  });

  test('snapshot mirrors every dimension for the audit record', () => {
    const result = composeReadiness(facts({}));
    // The fixed key order is part of the audit contract: removing or
    // reordering a dimension must fail loudly here.
    expect(result.dimensions.map((entry) => entry.key)).toEqual([
      'capacity',
      'qualification',
      'site',
      'travel',
      'material',
      'tools',
    ]);
    expect(result.snapshot).toEqual(
      result.dimensions.map((entry) => ({
        key: entry.key,
        state: entry.state,
        details: entry.details,
      })),
    );
  });
});
