import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipArchive } from '../testing/fixtures/export-profile-world';
import { delimitedRows, detectDelimiter } from './delimited-text';
import { readWorkbook } from './excel-workbook';
import { profileExportFolder } from './profile-export';
import { xmlRecords } from './xml-records';
import { decodeXmlEntities } from './xml-text';
import { ExportFormatError, openZip } from './zip-archive';

function formatErrorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof ExportFormatError ? error.code : `unexpected ${String(error)}`;
  }
}

describe('delimited text', () => {
  const text = 'Nr;Notiz\r\n1;"Zeile eins\nZeile zwei"\n2;"sagt ""ja"""\r3;5" Rohr\n';

  test('a quoted line break, a doubled quote and a literal quote follow one set of quote rules', () => {
    expect(detectDelimiter(text)).toBe(';');
    expect([...delimitedRows(text, ';')]).toEqual([
      ['Nr', 'Notiz'],
      ['1', 'Zeile eins\nZeile zwei'],
      ['2', 'sagt "ja"'],
      ['3', '5" Rohr'],
    ]);
  });

  test('a quoted field that never closes is a format error, not one long value', () => {
    expect(formatErrorCode(() => [...delimitedRows('Nr;Notiz\n1;"offen\n2;x\n', ';')])).toBe(
      'delimited_quote_unclosed',
    );
  });
});

describe('XML', () => {
  test('markup no rule matches is a format error', () => {
    expect(formatErrorCode(() => [...xmlRecords('<a><b>1</b> < <c>2</c></a>')])).toBe('xml_not_well_formed');
  });

  test('a character reference beyond Unicode stays literal text', () => {
    expect(decodeXmlEntities('&#x110000;&#228;')).toBe('&#x110000;ä');
  });
});

describe('ZIP and Excel', () => {
  test('an entry whose size runs past the archive end is damaged, not returned in part', () => {
    const bytes = zipArchive({ 'a.xml': '<a/>' });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const directory = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint32(directory + 20, 0x7fffffff, true);
    expect(formatErrorCode(() => openZip(bytes).read('a.xml'))).toBe('zip_entry_damaged');
  });

  test('a date-styled number beyond the calendar stays an ordinary value', () => {
    const bytes = zipArchive({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="Tabelle" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/styles.xml':
        '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>99999999999</v></c></row></sheetData></worksheet>',
    });
    const [sheet] = readWorkbook(bytes);
    expect(sheet ? [...sheet.rows()] : null).toEqual([[{ text: '99999999999' }]]);
  });
});

describe('incomplete input is unreadable, never a quiet partial profile', () => {
  test('a declared sheet whose part is missing makes the workbook unreadable', () => {
    const bytes = zipArchive({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="Tabelle" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    });
    expect(formatErrorCode(() => readWorkbook(bytes))).toBe('xlsx_sheet_missing');
  });

  test('a worksheet target relative to the workbook resolves', () => {
    const bytes = zipArchive({
      'xl/workbook.xml':
        '<workbook xmlns:r="r"><sheets><sheet name="Tabelle" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="./worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Nr</t></is></c></row></sheetData></worksheet>',
    });
    expect(readWorkbook(bytes).map((sheet) => [...sheet.rows()])).toEqual([[[{ text: 'Nr' }]]]);
  });

  test('a .csv whose separator cannot be told apart is reported, and one without any is one column', () => {
    const folder = mkdtempSync(join(tmpdir(), 'export-profile-csv-'));
    try {
      writeFileSync(join(folder, 'mehrdeutig.csv'), 'id,name\n1,"Jane\n');
      writeFileSync(join(folder, 'einspaltig.csv'), 'Name\n"Meier, Max"\n"Kurz"\n');
      const profile = profileExportFolder(folder, { maskLabels: false });
      expect(profile.unreadable).toEqual([
        {
          file: 'mehrdeutig.csv',
          reason: 'delimiter_ambiguous',
          advice: expect.stringContaining('ask Willert'),
        },
      ]);
      expect(profile.tables.map((table) => [table.file, table.columns.length])).toEqual([
        ['einspaltig.csv', 1],
      ]);
      expect(profile.files.tableFiles).toBe(1);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
