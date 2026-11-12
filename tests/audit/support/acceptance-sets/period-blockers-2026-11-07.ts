import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#136 of 2026-11-07: a prepared month with
 * blockers, grouped per kind with their fix, for Admin and for Büro.
 */
function periodBlockerCaptures(): OpenSet {
  return {
    id: 'period-blockers-2026-11-07',
    captures: (['admin', 'buero'] as const).flatMap((role) =>
      [
        { reveal: 'Monatswerte', part: 'werte' },
        { reveal: 'Prüfhinweise', part: 'hinweise' },
      ].map(({ reveal, part }) => ({
        id: `${role}-periode-${part}`,
        role,
        route: '/zeiterfassung/perioden/[periodId]' as const,
        view: { kind: 'page' } as const,
        widths: [1280, 375] as const,
        schemes: ['light', 'dark'] as const,
        reveal,
      })),
    ),
    standalone: [],
  };
}

acceptanceSet(periodBlockerCaptures());
