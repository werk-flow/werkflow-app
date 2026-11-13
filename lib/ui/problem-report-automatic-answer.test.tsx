import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OwnProblemReportList } from '@/components/problem-reports/own-problem-report-list';
import type { OwnProblemReport } from '@/lib/problem-reports/types';

// „Meine Meldungen“ marks an answer a report thread wrote, on the phone card
// and in the desktop table, and leaves support's answer as it was
// (docs/features/problem-reports.md, "Automatic answer").

const LABEL = 'Automatisch geschrieben';

const report = (id: string, number: number, responseByAgent: boolean): OwnProblemReport => ({
  id,
  number,
  createdAt: '2026-11-12T08:00:00.000Z',
  status: 'erledigt',
  closedAt: '2026-11-12T09:00:00.000Z',
  response: responseByAgent ? 'Behoben, ab morgen live.' : 'Wir haben es nachgestellt.',
  responseByAgent,
  description: 'Die Liste bleibt leer.',
});

const occurrences = (markup: string, text: string): number => markup.split(text).length - 1;

test('an answer a report thread wrote carries the automatic label on the card and in the table', () => {
  const markup = renderToStaticMarkup(<OwnProblemReportList reports={[report('agent', 1, true)]} />);
  expect(occurrences(markup, LABEL)).toBe(2);
});

test("support's answer carries no automatic label", () => {
  const markup = renderToStaticMarkup(<OwnProblemReportList reports={[report('support', 2, false)]} />);
  expect(markup).toContain('Wir haben es nachgestellt.');
  expect(markup).not.toContain(LABEL);
});
