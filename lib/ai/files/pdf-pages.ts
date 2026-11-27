import { inflateSync } from 'node:zlib';

// The page count of an uploaded PDF for the page cap (werk-flow/werkflow-planning#534,
// B13), read without a PDF parser: a customer's file may be crafted, so the
// reader scans forward only, decodes at most a fixed budget, prints nothing
// and keeps no state. It follows the active page tree as the specification
// defines it (PDF 32000-1, 7.7.2 and 7.7.3): the last trailer's /Root, the
// catalog's /Pages, that node's /Count. An object lies in the file or in a
// Flate object stream. A file whose tree it cannot follow reads as
// unreadable. Reading the content stays with KI-9's quarantined extractor (B9).

/** Bytes the object streams of one file may decode to, all together. */
const DECODED_BUDGET_BYTES = 50 * 1024 * 1024;
/** Mentions of /ObjStm one file may hold; past them it is refused, which bounds the scan's work. */
const MAX_OBJECT_STREAM_MENTIONS = 10_000;
/** How far an object stream's dictionary may lie from its /ObjStm. */
const DICTIONARY_REACH = 4_096;
/** The longest object text the reader looks into. */
const MAX_OBJECT_CHARS = 65_536;

type ObjectStream = { decoded: string; first: number; offsets: Map<number, number> };

function lastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  let last: RegExpExecArray | null = null;
  for (const match of text.matchAll(pattern)) last = match;
  return last;
}

/** The text of object `number` written directly in the file, its latest revision. */
function directObject(text: string, number: number): string | null {
  const header = lastMatch(
    text,
    new RegExp(`(?<![0-9])${number}[ \\t\\r\\n]+\\d+[ \\t\\r\\n]+obj(?![A-Za-z])`, 'g'),
  );
  if (!header) return null;
  const start = header.index + header[0].length;
  const end = text.indexOf('endobj', start);
  return text.slice(start, end < 0 ? start + MAX_OBJECT_CHARS : Math.min(end, start + MAX_OBJECT_CHARS));
}

/** The offsets of an object stream's objects, from its header of number and offset pairs. */
function streamOffsets(header: string): Map<number, number> {
  const numbers = header.trim().split(/\s+/).map(Number);
  const offsets = new Map<number, number>();
  for (let index = 0; index + 1 < numbers.length; index += 2)
    offsets.set(numbers[index] ?? -1, numbers[index + 1] ?? -1);
  return offsets;
}

/** Every Flate object stream of the file, decoded within the budget; null when one cannot be. */
function objectStreams(buffer: Buffer, text: string): ObjectStream[] | null {
  const streams: ObjectStream[] = [];
  let budget = DECODED_BUDGET_BYTES;
  let mentions = 0;
  for (let at = text.indexOf('/ObjStm'); at >= 0; at = text.indexOf('/ObjStm', at + 1)) {
    mentions += 1;
    if (mentions > MAX_OBJECT_STREAM_MENTIONS) return null;
    // The dictionary around the mention, each side read at most DICTIONARY_REACH far.
    const before = Math.max(0, at - DICTIONARY_REACH);
    const opening = text.slice(before, at).lastIndexOf('<<');
    const ahead = text.slice(at, at + DICTIONARY_REACH).indexOf('stream');
    // A mention outside an object stream's dictionary, such as in a text string.
    if (opening < 0 || ahead < 0) continue;
    const keyword = at + ahead;
    const dictionary = text.slice(before + opening, keyword);
    const first = Number(/\/First\s+(\d+)/.exec(dictionary)?.[1] ?? Number.NaN);
    if (!/\/Filter\s*\/FlateDecode(?![A-Za-z0-9#])/.test(dictionary) || !Number.isSafeInteger(first))
      return null;
    const start = keyword + (text.startsWith('stream\r\n', keyword) ? 8 : 7);
    const end = text.indexOf('endstream', start);
    if (end < 0) return null;
    let decoded: string;
    try {
      const bytes = inflateSync(buffer.subarray(start, end), { maxOutputLength: budget });
      budget -= bytes.byteLength;
      decoded = bytes.toString('latin1');
    } catch {
      // Past the budget, encrypted or broken: the tree cannot be followed.
      return null;
    }
    streams.push({ decoded, first, offsets: streamOffsets(decoded.slice(0, first)) });
    // Forward only: the stream's own bytes are never scanned again.
    at = end;
  }
  return streams;
}

/** The text of object `number`, written directly or inside an object stream. */
function objectText(text: string, streams: readonly ObjectStream[], number: number): string | null {
  const direct = directObject(text, number);
  if (direct !== null) return direct;
  for (const stream of streams) {
    const offset = stream.offsets.get(number);
    if (offset === undefined) continue;
    const start = stream.first + offset;
    return stream.decoded.slice(start, start + MAX_OBJECT_CHARS);
  }
  return null;
}

/** The object number a dictionary entry refers to. */
function reference(text: string | null, key: string): number | null {
  const match = text === null ? null : new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(text);
  return match ? Number(match[1]) : null;
}

/** The pages of a PDF as its page tree's root counts them, or null when the tree cannot be followed. */
export function countPdfPages(bytes: Uint8Array): number | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = buffer.toString('latin1');
  if (!text.startsWith('%PDF-')) return null;
  // The last trailer, or cross-reference stream, names the catalog of the file's latest revision.
  const root = lastMatch(text, /\/Root\s+(\d+)\s+\d+\s+R/g);
  const streams = objectStreams(buffer, text);
  if (!root || !streams) return null;
  const pages = reference(objectText(text, streams, Number(root[1])), 'Pages');
  const tree = pages === null ? null : objectText(text, streams, pages);
  const value = Number((tree === null ? null : /\/Count\s+(\d+)/.exec(tree))?.[1] ?? 0);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
