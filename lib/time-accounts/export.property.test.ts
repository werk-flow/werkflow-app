import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { buildPayrollExportPackage, distributeCreditedMinutes } from './export';
import type {
  PayrollExportAllocationRow,
  PayrollExportCorrectionRow,
  PayrollExportInput,
  PayrollExportValueRow,
} from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Payroll export": one reproducible payroll-ready ZIP per closed period version. The same rows
// give the same bytes in any order, the control sums are the sums of the rows, and the credited
// minutes of a day are allocated to its sources without losing or adding a minute.

const sharesArbitrary = fc.record({
  rows: fc.uniqueArray(
    fc.record({
      id: fc.stringMatching(/^[a-z0-9]{1,6}$/),
      sourceSeconds: fc.integer({ min: -60, max: 50_000 }),
    }),
    { selector: (row) => row.id, maxLength: 8 },
  ),
  creditedMinutes: fc.nat({ max: 2_000 }),
});

describe('Allocating a day’s credited minutes to its sources', () => {
  test('hands out exactly the credited minutes, each source within a minute of its exact share', () => {
    fc.assert(
      fc.property(sharesArbitrary, ({ rows, creditedMinutes }) => {
        const shares = distributeCreditedMinutes(rows, creditedMinutes);
        const total = rows.reduce((sum, row) => sum + Math.max(0, row.sourceSeconds), 0);
        expect([...shares.keys()].sort()).toEqual(rows.map((row) => row.id).sort());
        if (total === 0) {
          for (const minutes of shares.values()) expect(minutes).toBe(0);
          return;
        }
        expect([...shares.values()].reduce((sum, minutes) => sum + minutes, 0)).toBe(creditedMinutes);
        for (const row of rows) {
          // Integer floor of creditedMinutes × seconds ÷ total, without floating point.
          const floor = Math.floor((creditedMinutes * Math.max(0, row.sourceSeconds)) / total);
          expect(shares.get(row.id)).toBeGreaterThanOrEqual(floor);
          expect(shares.get(row.id)).toBeLessThanOrEqual(floor + 1);
        }
      }),
    );
  });

  test('gives the same minutes whatever order the sources come in', () => {
    fc.assert(
      fc.property(
        sharesArbitrary.chain(({ rows, creditedMinutes }) =>
          fc.record({
            rows: fc.constant(rows),
            shuffled: fc.shuffledSubarray(rows, { minLength: rows.length }),
            creditedMinutes: fc.constant(creditedMinutes),
          }),
        ),
        ({ rows, shuffled, creditedMinutes }) => {
          expect(new Map([...distributeCreditedMinutes(shuffled, creditedMinutes)].sort())).toEqual(
            new Map([...distributeCreditedMinutes(rows, creditedMinutes)].sort()),
          );
        },
      ),
    );
  });
});

const idArbitrary = fc.stringMatching(/^[a-z0-9-]{1,10}$/);
const textArbitrary = fc.string({ maxLength: 12 });
const dateArbitrary = fc.constantFrom('2026-10-01', '2026-10-25', '2026-10-31');

const valueRowArbitrary: fc.Arbitrary<Omit<PayrollExportValueRow, 'rowId'>> = fc.record({
  employeeRecordId: idArbitrary,
  externalEmployeeReference: textArbitrary,
  localDate: dateArbitrary,
  valueKind: fc.constantFrom('target' as const, 'credited_activity' as const, 'closing_balance' as const),
  outputCode: textArbitrary,
  sourceSeconds: fc.nat({ max: 100_000 }),
  minutes: fc.integer({ min: -10_000, max: 10_000 }),
  roundingDeltaSeconds: fc.integer({ min: -30, max: 30 }),
  policyVersionId: idArbitrary,
  calculationVersion: fc.integer({ min: 1, max: 5 }),
});

const allocationRowArbitrary: fc.Arbitrary<Omit<PayrollExportAllocationRow, 'rowId'>> = fc.record({
  employeeRecordId: idArbitrary,
  externalEmployeeReference: textArbitrary,
  localDate: dateArbitrary,
  activityKind: fc.constantFrom('work' as const, 'travel' as const, 'standby' as const),
  sourceReference: textArbitrary,
  sourceSeconds: fc.nat({ max: 100_000 }),
  creditedMinutes: fc.nat({ max: 2_000 }),
  allocationKind: fc.constantFrom('job', 'unallocated'),
  jobNumber: textArbitrary,
  projectNumber: textArbitrary,
});

const correctionRowArbitrary: fc.Arbitrary<Omit<PayrollExportCorrectionRow, 'rowId'>> = fc.record({
  employeeRecordId: idArbitrary,
  requestId: idArbitrary,
  revision: fc.integer({ min: 1, max: 9 }),
  applicationId: idArbitrary,
  sourceFingerprint: textArbitrary,
});

/** Rows with unique ids, as the export rows give them. */
function withRowIds<Row>(row: fc.Arbitrary<Row>): fc.Arbitrary<Array<Row & { rowId: string }>> {
  return fc
    .uniqueArray(fc.tuple(idArbitrary, row), { selector: ([rowId]) => rowId, maxLength: 4 })
    .map((rows) => rows.map(([rowId, fields]) => ({ ...fields, rowId })));
}

const exportInputArbitrary: fc.Arbitrary<PayrollExportInput> = fc.record({
  manifest: fc.record({
    schemaVersion: fc.constant(1 as const),
    exportId: idArbitrary,
    exportVersion: fc.integer({ min: 1, max: 5 }),
    supersedesExportId: fc.option(idArbitrary, { nil: null }),
    organizationId: idArbitrary,
    periodStart: fc.constant('2026-10-01'),
    periodEnd: fc.constant('2026-10-31'),
    closeVersion: fc.integer({ min: 1, max: 5 }),
    mappingVersion: fc.integer({ min: 1, max: 5 }),
    generatorVersion: fc.constant('p1-23-v1'),
    generatedAt: fc.constant('2026-11-01T08:00:00.000Z'),
    scope: fc.constant('organization_period' as const),
  }),
  valueRows: withRowIds(valueRowArbitrary),
  allocationRows: withRowIds(allocationRowArbitrary),
  correctionRows: withRowIds(correctionRowArbitrary),
});

const decoder = new TextDecoder();

describe('The payroll export package', () => {
  test('has the same bytes and checksum for the same rows in any order', () => {
    fc.assert(
      fc.property(
        exportInputArbitrary.chain((input) =>
          fc.record({
            input: fc.constant(input),
            values: fc.shuffledSubarray([...input.valueRows], { minLength: input.valueRows.length }),
            allocations: fc.shuffledSubarray([...input.allocationRows], {
              minLength: input.allocationRows.length,
            }),
            corrections: fc.shuffledSubarray([...input.correctionRows], {
              minLength: input.correctionRows.length,
            }),
          }),
        ),
        ({ input, values, allocations, corrections }) => {
          const first = buildPayrollExportPackage(input);
          const again = buildPayrollExportPackage({
            manifest: { ...input.manifest },
            valueRows: values,
            allocationRows: allocations,
            correctionRows: corrections,
          });
          expect(again.sha256).toBe(first.sha256);
          expect(again.bytes).toEqual(first.bytes);
        },
      ),
    );
  });

  test('carries control sums that are the counts and sums of its rows', () => {
    fc.assert(
      fc.property(exportInputArbitrary, (input) => {
        const { files } = buildPayrollExportPackage(input);
        const controlFile = files['kontrollsummen.csv'];
        expect(controlFile).toBeDefined();
        const lines = decoder.decode(controlFile).trim().split(/\r?\n/);
        const sum = (pick: (row: PayrollExportValueRow) => number): number =>
          input.valueRows.reduce((total, row) => total + pick(row), 0);
        expect(lines.at(-1)?.split(/[;,]/).map(Number)).toEqual([
          input.valueRows.length,
          input.allocationRows.length,
          input.correctionRows.length,
          sum((row) => row.sourceSeconds),
          sum((row) => row.minutes),
          sum((row) => row.roundingDeltaSeconds),
        ]);
      }),
    );
  });
});
