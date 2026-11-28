import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

import { countPdfPages } from './pdf-pages';

async function pdf(pages: number, useObjectStreams: boolean): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let page = 0; page < pages; page += 1) document.addPage();
  return document.save({ useObjectStreams });
}

const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');

/** One object stream of `entries` index entries that inflates to `bytes` zeros. */
function objectStreamOf(bytes: number, entries = 1): Buffer {
  const data = deflateSync(Buffer.alloc(bytes));
  return Buffer.concat([
    latin1(
      `99 0 obj\n<< /Type /ObjStm /N ${entries} /First 0 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
    ),
    data,
    latin1('\nendstream\nendobj\n'),
  ]);
}

/** A PDF with its page tree in object streams, their filter written as `filter`. */
async function compressedWithFilter(pages: number, filter: string): Promise<Buffer> {
  const file = Buffer.from(await pdf(pages, true)).toString('latin1');
  expect(file).toContain('/Filter /FlateDecode');
  return latin1(file.replaceAll('/Filter /FlateDecode', `/Filter ${filter}`));
}

describe('the page count of an uploaded PDF', () => {
  test("counts the page tree's pages, with and without object streams", async () => {
    expect(countPdfPages(await pdf(2, false))).toBe(2);
    expect(countPdfPages(await pdf(21, true))).toBe(21);
  });

  test('page dictionaries quoted in text or comments do not count', async () => {
    const quoted = ' (/Type /Page /Count 99) /ObjStm'.repeat(30);
    const file = Buffer.concat([Buffer.from(await pdf(1, false)), latin1(`%${quoted}\n`)]);
    expect(countPdfPages(file)).toBe(1);
  });

  test('a file whose page tree cannot be followed has no count', () => {
    expect(countPdfPages(latin1('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n'))).toBeNull();
  });

  test('an object stream filtered by Flate is read whether the filter is a name or an array of it', async () => {
    expect(countPdfPages(await compressedWithFilter(3, '[/FlateDecode]'))).toBe(3);
    expect(countPdfPages(await compressedWithFilter(3, '[ /FlateDecode ]'))).toBe(3);
    expect(countPdfPages(await compressedWithFilter(3, '[/FlateDecode /ASCIIHexDecode]'))).toBeNull();
    expect(countPdfPages(await compressedWithFilter(3, '/FlateDecodeX'))).toBeNull();
  });

  test('a longer filter name that starts with FlateDecode is not taken for Flate', async () => {
    // A name ends only at white space or a delimiter (PDF 32000-1, 7.2.2): `-` is a regular character.
    expect(countPdfPages(await compressedWithFilter(3, '/FlateDecode-X'))).toBeNull();
    expect(countPdfPages(await compressedWithFilter(3, '/FlateDecode.X'))).toBeNull();
    expect(countPdfPages(await compressedWithFilter(3, '/FlateDecode/Length'))).toBe(3);
    expect(countPdfPages(await compressedWithFilter(3, '/FlateDecode>>'))).toBe(3);
    // PDF white space is its own six bytes: NUL ends a name, a no-break space (0xA0) does not.
    expect(countPdfPages(await compressedWithFilter(3, '[/FlateDecode\u0000]'))).toBe(3);
    expect(countPdfPages(await compressedWithFilter(3, '[/FlateDecode\u00a0]'))).toBeNull();
  });

  test('object stream indexes that list more objects than the bound are not read', async () => {
    // 100,001 entries in an index of zeros: the index is refused before any entry is kept.
    const file = Buffer.concat([Buffer.from(await pdf(1, false)), objectStreamOf(1024, 100_001)]);
    expect(countPdfPages(file)).toBeNull();
    expect(
      countPdfPages(Buffer.concat([Buffer.from(await pdf(1, false)), objectStreamOf(1024, 100_000)])),
    ).toBe(1);
  });

  test('an object stream that decodes past the budget is refused before it is held', async () => {
    // 60 MB of zeros deflate to about 60 KB: the upload cap alone would let it through.
    const file = Buffer.concat([Buffer.from(await pdf(1, false)), objectStreamOf(60 * 1024 * 1024)]);
    expect(countPdfPages(file)).toBeNull();
  });

  test('an object stream that is not Flate cannot be followed', async () => {
    const plain = latin1('99 0 obj\n<< /Type /ObjStm /N 1 /First 0 /Length 3 >>\nstream\nabc\nendstream\n');
    expect(countPdfPages(Buffer.concat([Buffer.from(await pdf(1, false)), plain]))).toBeNull();
  });

  test('a readable file stops being read once its object stream mentions pass their bound', async () => {
    // Mentions in a trailing comment: no `stream` follows them, so none is decoded.
    const withMentions = async (mentions: number) =>
      Buffer.concat([Buffer.from(await pdf(1, false)), latin1(`%${' /ObjStm'.repeat(mentions)}\n`)]);
    expect(countPdfPages(await withMentions(10_000))).toBe(1);
    expect(countPdfPages(await withMentions(10_001))).toBeNull();
  });
});
