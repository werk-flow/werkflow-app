// Component contract: the period's Prüfhinweise group per kind and say who fixes each and where
// (werk-flow/werkflow-planning#48), for an Admin and for Büro; the close stays pressable (#88).
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BannerProvider } from '@/components/ui/banner';
import type { TimePeriodDetail } from '@/lib/time-accounts/queries';

mock.module('@/lib/time-accounts/decision-actions', () => ({
  decidePeriodFinding: async () => ({ success: true }),
}));
mock.module('@/lib/time-accounts/actions', () => ({
  closeTimePeriod: async () => ({ success: true }),
}));
const { TimePeriodFindings } = await import('@/components/zeiterfassung/time-period-findings');
const { TimePeriodCloseForm } = await import('@/components/zeiterfassung/time-period-close-form');

type Finding = TimePeriodDetail['findings'][number];

const PERIOD_ID = 'c0000000-0000-4000-8000-000000000001';
const PEOPLE = [
  { id: 'a0000000-0000-4000-8000-00000000000a', name: 'Jonas Kaltenbach' },
  { id: 'a0000000-0000-4000-8000-00000000000b', name: 'Daniel Krüger' },
  { id: 'a0000000-0000-4000-8000-00000000000c', name: 'Kevin Franke' },
];

function finding(
  index: number,
  kind: Finding['kind'],
  severity: string,
  explanation: Record<string, unknown> = {},
): Finding {
  const person = PEOPLE[index % PEOPLE.length];
  return {
    id: `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    employeeRecordId: person?.id ?? null,
    employeeName: person?.name ?? null,
    kind,
    severity,
    explanation,
    decision: null,
    canApprove: true,
  };
}

// Three people without an account and without a policy, one without a
// Wochenplan, and one „Zeit ohne Zuordnung“ with its entries.
const FINDINGS: Finding[] = [
  finding(0, 'missing_opening_balance', 'close_blocked'),
  finding(1, 'missing_opening_balance', 'close_blocked'),
  finding(2, 'missing_opening_balance', 'close_blocked'),
  finding(3, 'missing_policy', 'close_blocked'),
  finding(4, 'missing_policy', 'close_blocked'),
  finding(5, 'missing_policy', 'close_blocked'),
  finding(6, 'unallocated_time', 'approval_required', {
    count: 1,
    minutes: 75,
    entries: [
      {
        date: '2026-09-07',
        startedAt: '2026-09-07T06:00:00.000Z',
        endedAt: '2026-09-07T07:15:00.000Z',
        activityKind: 'work',
        minutes: 75,
      },
    ],
  }),
  finding(8, 'missing_schedule', 'close_blocked'),
];

function render(viewer: { isAdmin: boolean; isOffice: boolean }): string {
  return renderToStaticMarkup(
    <BannerProvider>
      <TimePeriodFindings periodId={PERIOD_ID} findings={FINDINGS} liveSessions={[]} viewer={viewer} />
    </BannerProvider>,
  );
}

/** The markup of one kind's card, found by its accessible name. */
function card(markup: string, label: string): string {
  const start = markup.indexOf(`<article aria-label="${label}"`);
  expect(start, `no card for ${label}`).toBeGreaterThanOrEqual(0);
  return markup.slice(start, markup.indexOf('</article>', start));
}

describe('period findings', () => {
  test('one card per kind with every affected person, not one row per finding', () => {
    const markup = render({ isAdmin: true, isOffice: true });
    expect(markup.match(/<article /g)).toHaveLength(4);
    const accounts = card(markup, 'Zeitkonto fehlt');
    expect(accounts).toContain('3 Personen');
    for (const person of PEOPLE) expect(accounts).toContain(person.name);
    // Blocking kinds come first, in the label order.
    expect(markup.indexOf('aria-label="Arbeitszeitregel fehlt"')).toBeLessThan(
      markup.indexOf('aria-label="Zeitkonto fehlt"'),
    );
    expect(markup.indexOf('aria-label="Arbeitsplan fehlt"')).toBeLessThan(
      markup.indexOf('aria-label="Zeit ohne Zuordnung"'),
    );
  });

  test('as Admin, each setup gap links to its fixing screen', () => {
    const markup = render({ isAdmin: true, isOffice: true });
    for (const label of ['Zeitkonto fehlt', 'Arbeitszeitregel fehlt']) {
      const group = card(markup, label);
      expect(group).toContain('href="/zeiterfassung/einstellungen"');
      expect(group).not.toContain('Nur Admin');
    }
    expect(card(markup, 'Arbeitsplan fehlt')).toContain(`href="/mitarbeiter/${PEOPLE[2]?.id}"`);
    // The accessible name keeps the visible text as one phrase, so a spoken „Arbeitszeitmodell öffnen“ finds it (WCAG 2.5.3).
    expect(card(markup, 'Arbeitsplan fehlt')).toContain(
      `aria-label="Arbeitszeitmodell öffnen: ${PEOPLE[2]?.name}"`,
    );
  });

  test('as Büro, Admin-only gaps say „Nur Admin“ without a link, the Wochenplan stays linked', () => {
    const markup = render({ isAdmin: false, isOffice: true });
    for (const label of ['Zeitkonto fehlt', 'Arbeitszeitregel fehlt']) {
      const group = card(markup, label);
      expect(group).toContain('Nur Admin');
      expect(group).not.toContain('href=');
    }
    const schedule = card(markup, 'Arbeitsplan fehlt');
    expect(schedule).not.toContain('Nur Admin');
    expect(schedule).toContain(`href="/mitarbeiter/${PEOPLE[2]?.id}"`);
  });

  test('a time-approval holder without an office role is pointed to Admin and Büro for the Wochenplan', () => {
    const schedule = card(render({ isAdmin: false, isOffice: false }), 'Arbeitsplan fehlt');
    expect(schedule).toContain('Nur Admin und Büro');
    expect(schedule).not.toContain('href=');
  });

  test('running sessions join one card with the stored finding of their kind', () => {
    const markup = renderToStaticMarkup(
      <BannerProvider>
        <TimePeriodFindings
          periodId={PERIOD_ID}
          findings={[finding(0, 'open_session', 'close_blocked', { startedAt: '2026-09-30T05:00:00.000Z' })]}
          liveSessions={[1, 2].map((index) => ({
            employeeRecordId: PEOPLE[index]?.id ?? '',
            employeeName: PEOPLE[index]?.name ?? '',
            startedAt: '2026-09-30T06:00:00.000Z',
            status: 'open' as const,
          }))}
          viewer={{ isAdmin: true, isOffice: true }}
        />
      </BannerProvider>,
    );
    expect(markup.match(/<article /g)).toHaveLength(1);
    const sessions = card(markup, 'Laufende Zeiterfassung');
    expect(sessions).toContain('3 Personen');
    for (const person of PEOPLE) expect(sessions).toContain(person.name);
    expect(sessions).toContain('seit 30.09.26, 08:00 · muss vor dem Abschluss beendet werden');
  });

  test('„Zeit ohne Zuordnung“ names the day, the minutes and the entry, and labels its reason field', () => {
    const unallocated = card(render({ isAdmin: true, isOffice: true }), 'Zeit ohne Zuordnung');
    expect(unallocated).toContain('Mo., 07.09.2026 · 08:00–09:15 · Arbeit · 1 Std. 15 Min.');
    const reasonId = `period-finding-reason-${FINDINGS[6]?.id}`;
    expect(unallocated).toMatch(new RegExp(`<label[^>]*for="${reasonId}"[^>]*>.*Begründung`));
    expect(unallocated).toContain(`id="${reasonId}"`);
  });
});

describe('period close', () => {
  test('„Monat abschließen“ stays enabled while blockers remain and names them beside it', () => {
    const blocker = '3 blockierende Hinweise müssen zuerst behoben werden.';
    const markup = renderToStaticMarkup(
      <BannerProvider>
        <TimePeriodCloseForm periodId={PERIOD_ID} blockers={[blocker]} />
      </BannerProvider>,
    );
    const button = markup.slice(markup.indexOf('<button'), markup.indexOf('</button>'));
    expect(button).toContain('Monat abschließen');
    expect(button).not.toMatch(/\sdisabled(=|\s|>|$)/);
    expect(markup).toContain(blocker);
  });
});
