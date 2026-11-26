// Component contract: an employee's own Zeitkonto shows a month the preparation
// could not calculate for them as „—“ with its cause, never 0:00, while a
// calculated month of zero still reads 0:00 (werk-flow/werkflow-planning#264).
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { TimeAccountPeriodList } from '@/components/zeiterfassung/time-account-overview-lists';

const ZERO = { targetMinutes: 0, creditedMinutes: 0, periodDeltaMinutes: 0, closingBalanceMinutes: 0 };

function render(outcome: Parameters<typeof TimeAccountPeriodList>[0]['periods'][number]['outcome']): string {
  return renderToStaticMarkup(
    <TimeAccountPeriodList
      periods={[{ id: 'p1', startDate: '2026-11-01', endDate: '2026-11-30', state: 'prepared', outcome }]}
    />,
  );
}

test('an uncalculated month shows „—“ and its cause in the table and on the phone card', () => {
  const html = render({ computed: false, causes: ['missing_opening_balance'] });
  // Three values each in the phone card and the table row.
  expect(html.match(/nicht berechnet</g)).toHaveLength(6);
  expect(html.match(/Nicht berechnet: Zeitkonto fehlt/g)).toHaveLength(2);
  expect(html).not.toContain('0:00');
});

test('a calculated month of zero shows 0:00', () => {
  const html = render({ computed: true, ...ZERO });
  expect(html.match(/0:00/g)).toHaveLength(6);
  expect(html).not.toContain('Nicht berechnet');
  expect(html).not.toContain('nicht berechnet');
});
