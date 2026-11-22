import { expect, mock, test } from 'bun:test';
import { getDocumentProxy } from 'unpdf';

import type { ServiceReport } from '@/lib/service-reports/model';

mock.module('server-only', () => ({}));
const { renderBusinessDocument } = await import('./render');
const { serviceReportDocument } = await import('./service-report-layout');
const { offerLetterhead } = await import('@/lib/company-profile/letterhead');
const { EMPTY_COMPANY_PROFILE_DETAILS } = await import('@/lib/company-profile/profile');

const report: ServiceReport = {
  issuedOn: '2026-11-17',
  visitedOn: '2026-11-14',
  jobNumber: 'A-2026-0042',
  recipient: {
    name: 'Hausverwaltung Lindenhof GmbH',
    addressLines: ['Lindenstraße 12', '12345 Musterstadt'],
  },
  site: { name: 'Wohnanlage Lindenhof', addressLines: ['Am Park 3', '12345 Musterstadt'] },
  equipment: [
    {
      name: 'Gas-Brennwertkessel',
      equipmentNumber: 'AN-0007',
      makeAndModel: 'Musterwerk Therm 25',
      location: 'Keller',
    },
  ],
  outcome: 'partial',
  workDone: ['Brenner gereinigt, Zündelektrode getauscht.'],
  readings: [{ description: 'Kondensatleitung', location: 'Keller', value: '2,5 m' }],
  openDefects: ['Ausdehnungsgefäß ohne Vordruck'],
  nextStep: 'Für die offenen Mängel ist ein weiterer Besuch bis 01.12.2026 geplant.',
  signature: { signerName: 'Erika Musterfrau', signedOn: '2026-11-14' },
};

async function pdfLines(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes.slice());
  const lines: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    for (const item of content.items) if ('str' in item && item.str.trim()) lines.push(item.str);
  }
  return lines;
}

test('a Servicebericht prints the visit for the customer and no amount', async () => {
  const letterhead = offerLetterhead(EMPTY_COMPANY_PROFILE_DETAILS, {}, 'Haustechnik Sonnenberg GmbH');
  const bytes = await renderBusinessDocument(serviceReportDocument(report, letterhead));
  // Joined with spaces, so a value the info block wraps still reads as one.
  const text = (await pdfLines(bytes)).join(' ');
  for (const expected of [
    'Servicebericht',
    'Hausverwaltung Lindenhof GmbH',
    'Besuch am',
    '14.11.2026',
    'A-2026-0042',
    'Wohnanlage Lindenhof, Am Park 3, 12345 Musterstadt',
    'Gas-Brennwertkessel · Musterwerk Therm 25 · Anlage AN-0007 · Standort Keller',
    'Brenner gereinigt, Zündelektrode getauscht.',
    'Kondensatleitung · Keller · 2,5 m',
    'Teilweise erledigt',
    '– Ausdehnungsgefäß ohne Vordruck',
    'Für die offenen Mängel ist ein weiterer Besuch bis 01.12.2026 geplant.',
    'Bestätigt von Erika Musterfrau am 14.11.2026',
    'Seite 1 von 1',
  ]) {
    expect(text).toContain(expected);
  }
  expect(text).not.toContain('€');
  expect(text).not.toContain('Gesamt');
});
