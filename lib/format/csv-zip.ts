// The CSV encoder and the stored-ZIP writer of every file WerkFlow builds for
// a download: the payroll export (lib/time-accounts/export.ts) and the
// organization export (lib/org-export/). The readers are German Excel users:
// `;` separates, a UTF-8 BOM marks the encoding, and a cell that starts like
// a formula is neutralized. The payroll package must keep every byte, so a
// change here passes lib/time-accounts/export.test.ts unchanged.

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
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

const CRC32_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeCsv(value: string | number): string {
  const raw = String(value);
  const normalized = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

/** A CSV file: BOM, `;` between cells, CRLF after every row, the header first. */
export function buildCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): Uint8Array {
  const body = [headers, ...rows].map((row) => row.map(escapeCsv).join(';')).join('\r\n') + '\r\n';
  return concatenate([CSV_BOM, encoder.encode(body)]);
}

/**
 * An uncompressed ZIP of the files, in name order, with UTF-8 names and a
 * fixed timestamp, so the same files always give the same bytes. Each file's
 * bytes are copied once, into the result.
 */
export function buildStoredZip(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  if (Object.keys(files).length > 0xffff) throw new Error('zip64_required');
  for (const name of Object.keys(files).sort()) {
    const data = files[name];
    if (data === undefined) throw new Error('zip_entry_missing');
    const nameBytes = encoder.encode(name);
    if (data.length > 0xffffffff || nameBytes.length > 0xffff || offset > 0xffffffff)
      throw new Error('zip64_required');
    const checksum = crc32(data);
    const localHeader = concatenate([
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
    ]);
    localParts.push(localHeader, data);
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
    offset += localHeader.length + data.length;
  }
  const central = concatenate(centralParts);
  if (central.length > 0xffffffff || offset > 0xffffffff) throw new Error('zip64_required');
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
