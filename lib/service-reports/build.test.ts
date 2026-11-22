import { describe, expect, test } from 'bun:test';

import { buildServiceReport, type ServiceReportSource } from './build';
import type { ServiceReport } from './model';

/** Every key at any depth of a type. */
type DeepKeys<T> =
  T extends Array<infer Item>
    ? DeepKeys<Item>
    : T extends object
      ? { [Key in keyof T]: Key | DeepKeys<T[Key]> }[keyof T]
      : never;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// The report's whole vocabulary. A new field fails this check until it is
// named here, so whoever adds one decides that it is customer-safe: never an
// internal note, a completion reason, triage, coverage, an owner, a price or a cost.
type CustomerSafeKey =
  | 'issuedOn'
  | 'visitedOn'
  | 'jobNumber'
  | 'recipient'
  | 'site'
  | 'name'
  | 'addressLines'
  | 'equipment'
  | 'equipmentNumber'
  | 'makeAndModel'
  | 'location'
  | 'outcome'
  | 'workDone'
  | 'readings'
  | 'description'
  | 'value'
  | 'openDefects'
  | 'nextStep'
  | 'signature'
  | 'signerName'
  | 'signedOn';
const onlyCustomerSafeKeys: Equal<DeepKeys<ServiceReport>, CustomerSafeKey> = true;

const source: ServiceReportSource = {
  issuedOn: '2026-11-17',
  completedOn: '2026-11-14',
  scopeOutcome: 'complete',
  jobNumber: 'A-2026-0042',
  recipient: { name: 'Hausverwaltung Lindenhof GmbH', address: 'Lindenstraße 12\n12345 Musterstadt' },
  site: { name: 'Wohnanlage Lindenhof', street: 'Am Park 3', postalCode: '12345', city: 'Musterstadt' },
  equipment: [
    {
      name: 'Gas-Brennwertkessel',
      equipmentNumber: 'AN-0007',
      manufacturer: 'Musterwerk',
      model: 'Therm 25',
      locationDetail: 'Keller',
    },
  ],
  evidence: [
    {
      visibility: 'customer_facing',
      performedWork: 'Brenner gereinigt, Zündelektrode getauscht.',
      readings: [{ description: 'Kondensatleitung', location: 'Keller', quantity: 2.5, unit: 'meter' }],
      signature: { signerName: 'Erika Musterfrau', signedAt: '2026-11-14T15:30:00Z' },
    },
    {
      visibility: 'internal_only',
      performedWork: 'Kunde war unfreundlich, nächstes Mal zu zweit.',
      readings: [{ description: 'Interne Zählung', location: null, quantity: 1, unit: 'piece' }],
      signature: null,
    },
  ],
  finding: null,
};

describe('the Servicebericht model', () => {
  test('holds only customer-safe fields, at the type and at run time', () => {
    expect(onlyCustomerSafeKeys).toBe(true);
    const report: ServiceReport = buildServiceReport(source);
    // @ts-expect-error -- an office field has no place in the report.
    const withNote: ServiceReport = { ...report, internalNote: 'Nur für das Büro' };
    expect(withNote).toBeDefined();

    // A source that carries office facts anyway prints none of them.
    const officeFacts = {
      ...source,
      reason: 'Abschluss nach Rücksprache mit Max Mustermann',
      coverage: { coverageNumber: 'WV-0001', operationalNote: 'Kündigung droht' },
      finding: {
        defects: ['Ausdehnungsgefäß ohne Vordruck'],
        nextAction: 'return_visit' as const,
        targetDate: '2026-12-01',
        note: 'Teil bestellen, Lieferant zahlt',
        ownerUserId: '30000000-0000-4000-8000-000000000001',
      },
    };
    const printed = JSON.stringify(buildServiceReport(officeFacts));
    for (const secret of [
      'Rücksprache',
      'WV-0001',
      'Kündigung',
      'Lieferant',
      '30000000-0000-4000-8000-000000000001',
      'unfreundlich',
      'Interne Zählung',
    ]) {
      expect(printed).not.toContain(secret);
    }
  });

  test('a finished visit prints its work, readings and signature and no next step', () => {
    expect(buildServiceReport(source)).toEqual({
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
      outcome: 'complete',
      workDone: ['Brenner gereinigt, Zündelektrode getauscht.'],
      readings: [{ description: 'Kondensatleitung', location: 'Keller', value: '2,5 m' }],
      openDefects: [],
      nextStep: null,
      signature: { signerName: 'Erika Musterfrau', signedOn: '2026-11-14' },
    });
  });

  test.each([
    ['return_visit', '2026-12-01', 'Für die offenen Mängel ist ein weiterer Besuch bis 01.12.2026 geplant.'],
    [
      'warranty_check',
      '2026-11-30',
      'Wir klären bis 30.11.2026 mit dem Hersteller, wie die offenen Mängel behoben werden.',
    ],
    ['offer_replacement', '2026-11-28', 'Ein Angebot für den Austausch folgt bis 28.11.2026.'],
    ['none', null, 'Weitere Arbeiten sind derzeit nicht geplant.'],
  ] as const)(
    'a partial visit with next action %s prints its Mängel and next step',
    (nextAction, targetDate, text) => {
      const report = buildServiceReport({
        ...source,
        scopeOutcome: 'partial',
        finding: { defects: ['Ausdehnungsgefäß ohne Vordruck'], nextAction, targetDate },
      });
      expect(report.outcome).toBe('partial');
      expect(report.openDefects).toEqual(['Ausdehnungsgefäß ohne Vordruck']);
      expect(report.nextStep).toBe(text);
    },
  );

  test('a one-line address breaks at its commas, and a visit without customer-facing evidence prints no work', () => {
    const report = buildServiceReport({
      ...source,
      recipient: { name: 'Max Mustermann', address: 'Birkenweg 4, 12345 Musterstadt' },
      evidence: source.evidence.slice(1),
    });
    expect(report.recipient.addressLines).toEqual(['Birkenweg 4', '12345 Musterstadt']);
    expect(report.workDone).toEqual([]);
    expect(report.readings).toEqual([]);
    expect(report.signature).toBeNull();
  });
});
