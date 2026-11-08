import { createHash } from 'node:crypto';
import { canonicalize } from '@/lib/format/canonical-json';
import { buildCsv, buildStoredZip } from '@/lib/format/csv-zip';
import type {
  PayrollExportAllocationRow,
  PayrollExportCorrectionRow,
  PayrollExportInput,
  PayrollExportPackage,
  PayrollExportValueRow,
} from './types';

const encoder = new TextEncoder();

export function distributeCreditedMinutes(
  rows: readonly { id: string; sourceSeconds: number }[],
  creditedMinutes: number,
): Map<string, number> {
  const totalSourceSeconds = rows.reduce((total, row) => total + Math.max(0, row.sourceSeconds), 0);
  if (totalSourceSeconds === 0) return new Map(rows.map((row) => [row.id, 0]));
  const shares = rows.map((row) => {
    const exact = (creditedMinutes * Math.max(0, row.sourceSeconds)) / totalSourceSeconds;
    return {
      id: row.id,
      minutes: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining = creditedMinutes - shares.reduce((total, row) => total + row.minutes, 0);
  shares.sort((left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id));
  for (const share of shares) {
    if (remaining <= 0) break;
    share.minutes += 1;
    remaining -= 1;
  }
  return new Map(shares.map((row) => [row.id, row.minutes]));
}

function valueRow(row: PayrollExportValueRow): readonly (string | number)[] {
  return [
    row.rowId,
    row.employeeRecordId,
    row.externalEmployeeReference,
    row.localDate,
    row.valueKind,
    row.outputCode,
    row.sourceSeconds,
    row.minutes,
    row.roundingDeltaSeconds,
    row.policyVersionId,
    row.calculationVersion,
  ];
}

function allocationRow(row: PayrollExportAllocationRow): readonly (string | number)[] {
  return [
    row.rowId,
    row.employeeRecordId,
    row.externalEmployeeReference,
    row.localDate,
    row.activityKind,
    row.sourceReference,
    row.sourceSeconds,
    row.creditedMinutes,
    row.allocationKind,
    row.jobNumber,
    row.projectNumber,
  ];
}

function correctionRow(row: PayrollExportCorrectionRow): readonly (string | number)[] {
  return [
    row.rowId,
    row.employeeRecordId,
    row.requestId,
    row.revision,
    row.applicationId,
    row.sourceFingerprint,
  ];
}

function stableSort<T extends { rowId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => (left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0));
}

export function buildPayrollExportPackage(input: PayrollExportInput): PayrollExportPackage {
  const values = stableSort(input.valueRows);
  const allocations = stableSort(input.allocationRows);
  const corrections = stableSort(input.correctionRows);
  const totals = values.reduce(
    (result, row) => ({
      sourceSeconds: result.sourceSeconds + row.sourceSeconds,
      minutes: result.minutes + row.minutes,
      roundingDeltaSeconds: result.roundingDeltaSeconds + row.roundingDeltaSeconds,
    }),
    { sourceSeconds: 0, minutes: 0, roundingDeltaSeconds: 0 },
  );

  const files: Record<string, Uint8Array> = {
    'lohnwerte.csv': buildCsv(
      [
        'row_id',
        'employee_record_id',
        'external_employee_reference',
        'local_date',
        'value_kind',
        'output_code',
        'source_seconds',
        'minutes',
        'rounding_delta_seconds',
        'policy_version_id',
        'calculation_version',
      ],
      values.map(valueRow),
    ),
    'zuordnungen.csv': buildCsv(
      [
        'row_id',
        'employee_record_id',
        'external_employee_reference',
        'local_date',
        'activity_kind',
        'source_reference',
        'source_seconds',
        'credited_minutes',
        'allocation_kind',
        'job_number',
        'project_number',
      ],
      allocations.map(allocationRow),
    ),
    'korrekturen.csv': buildCsv(
      ['row_id', 'employee_record_id', 'request_id', 'revision', 'application_id', 'source_fingerprint'],
      corrections.map(correctionRow),
    ),
    'kontrollsummen.csv': buildCsv(
      [
        'value_rows',
        'allocation_rows',
        'correction_rows',
        'source_seconds',
        'minutes',
        'rounding_delta_seconds',
      ],
      [
        [
          values.length,
          allocations.length,
          corrections.length,
          totals.sourceSeconds,
          totals.minutes,
          totals.roundingDeltaSeconds,
        ],
      ],
    ),
    'manifest.json': encoder.encode(`${JSON.stringify(canonicalize(input.manifest), null, 2)}\n`),
  };
  const bytes = buildStoredZip(files);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    files,
  };
}
