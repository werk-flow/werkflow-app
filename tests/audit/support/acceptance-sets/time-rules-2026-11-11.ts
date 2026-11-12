import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#160 of 2026-11-11: every policy version with its
 * span, the shared account opening with „Alle eröffnen“, and the payroll code table.
 */
function timeRulesCaptures(): OpenSet {
  return {
    id: 'time-rules-2026-11-11',
    captures: [
      { reveal: 'Arbeitszeitregel', part: 'regel' },
      { reveal: 'Zeitkonten', part: 'konten' },
      { reveal: 'Lohnarten-Zuordnung', part: 'lohnarten' },
    ].map(({ reveal, part }) => ({
      id: `admin-zeitregeln-${part}`,
      role: 'admin' as const,
      route: '/zeiterfassung/einstellungen' as const,
      view: { kind: 'page' } as const,
      widths: [1280, 375] as const,
      schemes: ['light', 'dark'] as const,
      reveal,
    })),
    standalone: [],
  };
}

acceptanceSet(timeRulesCaptures());
