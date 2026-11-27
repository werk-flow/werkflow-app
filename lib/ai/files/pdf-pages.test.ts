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

/** One object stream that inflates to `bytes` zeros. */
function objectStreamOf(bytes: number): Buffer {
  const data = deflateSync(Buffer.alloc(bytes));
  return Buffer.concat([
    latin1(
      `99 0 obj\n<< /Type /ObjStm /N 1 /First 0 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
    ),
    data,
    latin1('\nendstream\nendobj\n'),
  ]);
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

  test('a file that is no PDF, or whose page tree cannot be followed, is unreadable', () => {
    expect(countPdfPages(latin1('kein PDF'))).toBeNull();
    expect(countPdfPages(latin1('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n'))).toBeNull();
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

  test('a file of object stream mentions alone is refused once the mentions pass their bound', () => {
    expect(countPdfPages(latin1(`%PDF-1.7\n${'1 0 obj /ObjStm '.repeat(200_000)}`))).toBeNull();
  });
});
