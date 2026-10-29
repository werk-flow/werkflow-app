import { inflateRawSync } from 'node:zlib';

// A minimal ZIP reader for Excel workbooks: the central directory, and stored
// or deflated entries. ZIP64 and encrypted entries are refused.

export class ExportFormatError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ExportFormatError';
    this.code = code;
  }
}

type ZipEntry = { name: string; method: number; flags: number; compressedSize: number; localOffset: number };

export type ZipArchive = { names: readonly string[]; read: (name: string) => Uint8Array | null };

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** Opens a ZIP archive held in memory. */
export function openZip(bytes: Uint8Array): ZipArchive {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (offset === 0xffffffff || count === 0xffff) throw new ExportFormatError('zip64_unsupported');
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder('utf-8');
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== DIRECTORY_ENTRY)
      throw new ExportFormatError('zip_directory_damaged');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      name,
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { names: [...entries.keys()], read: (name) => readEntry(bytes, view, entries.get(name)) };
}

function findEndOfDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_DIRECTORY) return offset;
  }
  throw new ExportFormatError('not_a_zip_archive');
}

function readEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry | undefined): Uint8Array | null {
  if (!entry) return null;
  if (entry.flags & 0x1) throw new ExportFormatError('zip_entry_encrypted');
  if (view.getUint32(entry.localOffset, true) !== LOCAL_HEADER)
    throw new ExportFormatError('zip_entry_damaged');
  const start =
    entry.localOffset +
    30 +
    view.getUint16(entry.localOffset + 26, true) +
    view.getUint16(entry.localOffset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRawSync(data);
  throw new ExportFormatError('zip_method_unsupported');
}
