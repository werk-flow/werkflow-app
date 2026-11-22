import { MAINTENANCE_SCOPE_OUTCOME_LABELS } from '@/lib/maintenance/types';
import type { ServiceReport } from '@/lib/service-reports/model';
import { formatGermanDate } from '@/lib/utils';

import type { BusinessDocument } from './model';

// The Servicebericht layout: a completed maintenance visit as the renderer's
// plain document, with the company's letterhead. It has no positions and no
// totals, so it prints no amount. Each part is a paragraph block of the
// opening text, so it breaks across pages like any text.

type Letterhead = Pick<BusinessDocument, 'sender' | 'footerColumns' | 'stationery'>;

const block = (heading: string, lines: string[]): string[] =>
  lines.length ? [`${heading}\n${lines.join('\n')}`] : [];

function equipmentLines(report: ServiceReport): string[] {
  return report.equipment.map((item) =>
    [
      item.name,
      item.makeAndModel,
      `Anlage ${item.equipmentNumber}`,
      item.location && `Standort ${item.location}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

function readingLines(report: ServiceReport): string[] {
  return report.readings.map((reading) =>
    [reading.description, reading.location, reading.value].filter(Boolean).join(' · '),
  );
}

/** A completed visit's report as the business document the renderer draws. */
export function serviceReportDocument(report: ServiceReport, letterhead: Letterhead): BusinessDocument {
  const outcome = MAINTENANCE_SCOPE_OUTCOME_LABELS[report.outcome];
  const parts = [
    ...block('Anlagen', equipmentLines(report)),
    ...block('Durchgeführte Arbeiten', report.workDone),
    ...block('Messwerte', readingLines(report)),
    `Ergebnis\n${outcome}`,
    ...block(
      'Offene Mängel',
      report.openDefects.map((defect) => `– ${defect}`),
    ),
    ...block('Nächster Schritt', report.nextStep ? [report.nextStep] : []),
    ...block(
      'Unterschrift',
      report.signature
        ? [`Bestätigt von ${report.signature.signerName} am ${formatGermanDate(report.signature.signedOn)}`]
        : [],
    ),
  ];
  return {
    issuedOn: report.issuedOn,
    sender: letterhead.sender,
    recipientLines: [report.recipient.name, ...report.recipient.addressLines],
    title: 'Servicebericht',
    metaRows: [
      { label: 'Datum', value: formatGermanDate(report.issuedOn) },
      { label: 'Besuch am', value: formatGermanDate(report.visitedOn) },
      ...(report.jobNumber ? [{ label: 'Auftrag', value: report.jobNumber }] : []),
      ...(report.site
        ? [{ label: 'Einsatzort', value: [report.site.name, ...report.site.addressLines].join(', ') }]
        : []),
    ],
    openingText: parts.join('\n\n'),
    sections: [],
    totals: null,
    closingText: '',
    footerColumns: letterhead.footerColumns,
    stationery: letterhead.stationery,
  };
}
