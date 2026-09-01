import { createHash } from "node:crypto";
import type {
  PayrollExportAllocationRow,
  PayrollExportCorrectionRow,
  PayrollExportInput,
  PayrollExportPackage,
  PayrollExportValueRow,
} from "./types";

const encoder = new TextEncoder();
const CSV_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const ZIP_FIXED_DOS_TIME = 0;
const ZIP_FIXED_DOS_DATE = 33;

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeCsv(value: string | number): string {
  const raw = String(value);
  const normalized =
    typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

export function distributeCreditedMinutes(
  rows: readonly { id: string; sourceSeconds: number }[],
  creditedMinutes: number,
): Map<string, number> {
  const totalSourceSeconds = rows.reduce(
    (total, row) => total + Math.max(0, row.sourceSeconds),
    0,
  );
  if (totalSourceSeconds === 0)
    return new Map(rows.map((row) => [row.id, 0]));
  const shares = rows.map((row) => {
    const exact =
      (creditedMinutes * Math.max(0, row.sourceSeconds)) / totalSourceSeconds;
    return {
      id: row.id,
      minutes: Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remaining =
    creditedMinutes - shares.reduce((total, row) => total + row.minutes, 0);
  shares.sort(
    (left, right) =>
      right.remainder - left.remainder || left.id.localeCompare(right.id),
  );
  for (const share of shares) {
    if (remaining <= 0) break;
    share.minutes += 1;
    remaining -= 1;
  }
  return new Map(shares.map((row) => [row.id, row.minutes]));
}

function buildCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): Uint8Array {
  const body =
    [headers, ...rows].map((row) => row.map(escapeCsv).join(";")).join("\r\n") +
    "\r\n";
  return concatenate([CSV_BOM, encoder.encode(body)]);
}

function buildStoredZip(
  files: Readonly<Record<string, Uint8Array>>,
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  if (Object.keys(files).length > 0xffff) throw new Error("zip64_required");
  for (const name of Object.keys(files).sort()) {
    const data = files[name];
    const nameBytes = encoder.encode(name);
    if (
      data.length > 0xffffffff ||
      nameBytes.length > 0xffff ||
      offset > 0xffffffff
    )
      throw new Error("zip64_required");
    const checksum = crc32(data);
    const local = concatenate([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(ZIP_FIXED_DOS_TIME),
      uint16(ZIP_FIXED_DOS_DATE),
      uint32(checksum),
      uint32(data.length),
      uint32(data.length),
      uint16(nameBytes.length),
      uint16(0),
      nameBytes,
      data,
    ]);
    localParts.push(local);
    centralParts.push(
      concatenate([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(ZIP_FIXED_DOS_TIME),
        uint16(ZIP_FIXED_DOS_DATE),
        uint32(checksum),
        uint32(data.length),
        uint32(data.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes,
      ]),
    );
    offset += local.length;
  }
  const central = concatenate(centralParts);
  if (central.length > 0xffffffff || offset > 0xffffffff)
    throw new Error("zip64_required");
  const end = concatenate([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(centralParts.length),
    uint16(centralParts.length),
    uint32(central.length),
    uint32(offset),
    uint16(0),
  ]);
  return concatenate([...localParts, central, end]);
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

function allocationRow(
  row: PayrollExportAllocationRow,
): readonly (string | number)[] {
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

function correctionRow(
  row: PayrollExportCorrectionRow,
): readonly (string | number)[] {
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
  return [...rows].sort((left, right) =>
    left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0,
  );
}

export function buildPayrollExportPackage(
  input: PayrollExportInput,
): PayrollExportPackage {
  const values = stableSort(input.valueRows);
  const allocations = stableSort(input.allocationRows);
  const corrections = stableSort(input.correctionRows);
  const totals = values.reduce(
    (result, row) => ({
      sourceSeconds: result.sourceSeconds + row.sourceSeconds,
      minutes: result.minutes + row.minutes,
      roundingDeltaSeconds:
        result.roundingDeltaSeconds + row.roundingDeltaSeconds,
    }),
    { sourceSeconds: 0, minutes: 0, roundingDeltaSeconds: 0 },
  );

  const files: Record<string, Uint8Array> = {
    "lohnwerte.csv": buildCsv(
      [
        "row_id",
        "employee_record_id",
        "external_employee_reference",
        "local_date",
        "value_kind",
        "output_code",
        "source_seconds",
        "minutes",
        "rounding_delta_seconds",
        "policy_version_id",
        "calculation_version",
      ],
      values.map(valueRow),
    ),
    "zuordnungen.csv": buildCsv(
      [
        "row_id",
        "employee_record_id",
        "external_employee_reference",
        "local_date",
        "activity_kind",
        "source_reference",
        "source_seconds",
        "credited_minutes",
        "allocation_kind",
        "job_number",
        "project_number",
      ],
      allocations.map(allocationRow),
    ),
    "korrekturen.csv": buildCsv(
      [
        "row_id",
        "employee_record_id",
        "request_id",
        "revision",
        "application_id",
        "source_fingerprint",
      ],
      corrections.map(correctionRow),
    ),
    "kontrollsummen.csv": buildCsv(
      [
        "value_rows",
        "allocation_rows",
        "correction_rows",
        "source_seconds",
        "minutes",
        "rounding_delta_seconds",
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
    "manifest.json": encoder.encode(
      `${JSON.stringify(canonicalize(input.manifest), null, 2)}\n`,
    ),
  };
  const bytes = buildStoredZip(files);
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    files,
  };
}
