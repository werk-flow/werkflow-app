import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

// A synthetic Sykasoft-like export for the export profiler's tests. Every
// person, address, number and account below is invented. SENSITIVE_VALUES
// lists the values that must never reach the profile.

export const SENSITIVE_VALUES = [
  'Müller',
  'Schmidt',
  'Weißgerber',
  'Jürgen',
  'Erika',
  'Hauptstraße 12',
  'Lindenallee 3a',
  'Am Ring 7',
  'Berlin',
  'Dresden',
  'Hamburg',
  '10115',
  '01067',
  '030 23125 456',
  '+49 40 23125 789',
  'juergen.mueller@example.de',
  'erika.schmidt@example.com',
  'DE89 3704 0044 0532 0130 00',
  '12.03.2019',
  '2024-03-01',
  'Müller Jürgen',
  'Rechnung 2023-001',
  'Baustelle Hauptstraße 12',
  'Heizungswartung Keller',
  'Kessel defekt',
  'Sonderrabatt zugesagt',
  'zeynep',
];

function windows1252(text: string): Uint8Array {
  return Uint8Array.from(
    [...text].map((character) => {
      const code = character.charCodeAt(0);
      if (code > 0xff) throw new Error('fixture text outside Windows-1252');
      return code;
    }),
  );
}

const ADDRESSES = [
  'KdNr;Name;Vorname;Strasse;PLZ;Ort;Telefon;E-Mail;Angelegt',
  '10001;Müller;Jürgen;Hauptstraße 12;10115;Berlin;030 23125 456;juergen.mueller@example.de;12.03.2019',
  '10002;Schmidt;Erika;Lindenallee 3a;01067;Dresden;+49 40 23125 789;erika.schmidt@example.com;01.07.2020',
  '10003;Weißgerber;Anna;Am Ring 7;20095;Hamburg;030 23125 111;;15.11.2021',
  '10004;"Kühn; GmbH";Ole;Bachweg 1;10117;Berlin;030 23125 222;info@kuehn.example;02.02.2022',
  '10005;Öztürk;Can;Feldstraße 99;10119;Berlin;030 23125 333;can@example.org;30.06.2023',
  '10006;Becker;Lena;Gartenweg 4;10178;Berlin;030 23125 444;lena@example.net;24.12.2024',
].join('\r\n');

const HEADERLESS = [
  'Müller;Jürgen;Hauptstraße 12;10115;Berlin;DE89 3704 0044 0532 0130 00',
  'Schmidt;Erika;Lindenallee 3a;01067;Dresden;DE02 1203 0000 0000 2020 51',
  'Weißgerber;Anna;Am Ring 7;20095;Hamburg;DE12 5001 0517 0648 4898 90',
].join('\n');

// Free text only, without a header row: its first row must not become column names.
const NOTES = [
  'Kessel defekt;Sonderrabatt zugesagt',
  'Thermostat tauschen;Kunde ruft zurück',
  'Pumpe läuft laut;Termin verschoben',
].join('\n');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Zeiterfassung>
  <Buchung id="1"><Mitarbeiter>Müller Jürgen</Mitarbeiter><AuftragNr>A-5001</AuftragNr><Datum>2024-03-01</Datum><Stunden>7,5</Stunden></Buchung>
  <Buchung id="2"><Mitarbeiter>Schmidt Erika</Mitarbeiter><AuftragNr>A-5002</AuftragNr><Datum>2024-03-02</Datum><Stunden>8,0</Stunden><Notiz><![CDATA[Heizungswartung Keller]]></Notiz></Buchung>
  <Buchung id="3"><Mitarbeiter>Müller Jürgen</Mitarbeiter><AuftragNr>A-5003</AuftragNr><Datum>2025-01-15</Datum><Stunden>4,25</Stunden></Buchung>
  <Buchung id="4"><Mitarbeiter>Weißgerber Anna</Mitarbeiter><AuftragNr>A-5004</AuftragNr><Datum>2025-02-03</Datum><Stunden>6,0</Stunden></Buchung>
</Zeiterfassung>
`;

const DATANORM = [
  'V;050;Großhandel Beispiel;Musterweg 1;12345;Musterstadt',
  'A;N;ART-1001;00;Kugelhahn DN15;Messing;1;0;Stck;1250',
  'A;N;ART-1002;00;Thermostatkopf;weiß;1;0;Stck;2490',
  'A;N;ART-1003;00;Pressfitting 22mm;Kupfer;1;0;Stck;380',
  'B;N;ART-1001;Kugelhahn;;;',
].join('\r\n');

function pdf(pages: number): string {
  const kids = Array.from({ length: pages }, (_, index) => `${index + 3} 0 R`).join(' ');
  const pageObjects = Array.from(
    { length: pages },
    (_, index) => `${index + 3} 0 obj << /Type /Page /Parent 2 0 R >> endobj`,
  );
  return [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    `2 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages} >> endobj`,
    ...pageObjects,
    'trailer << /Root 1 0 R >>',
    '%%EOF',
  ].join('\n');
}

/** A ZIP archive with deflated entries, as Excel writes it. */
function zip(entries: Readonly<Record<string, string>>): Uint8Array {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, compressed);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

function workbook(): Uint8Array {
  const shared = [
    'AuftragNr',
    'KdNr',
    'Datum',
    'Betrag',
    'Status',
    'A-5001',
    'A-5002',
    'A-5003',
    'A-5004',
    'offen',
    'erledigt',
    'Beginn',
  ];
  const sharedXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((text) => `<si><t>${text}</t></si>`).join('')}</sst>`;
  const row = (index: number, cells: string): string => `<row r="${index}">${cells}</row>`;
  const text = (reference: string, sharedIndex: number): string =>
    `<c r="${reference}" t="s"><v>${sharedIndex}</v></c>`;
  const number = (reference: string, value: string, style?: number): string =>
    `<c r="${reference}"${style === undefined ? '' : ` s="${style}"`}><v>${value}</v></c>`;
  const rows = [
    row(
      1,
      [0, 1, 2, 3, 4, 11].map((sharedIndex, column) => text(`${'ABCDEF'[column]}1`, sharedIndex)).join(''),
    ),
    row(
      2,
      text('A2', 5) +
        number('B2', '10001') +
        number('C2', '43831', 1) +
        number('D2', '1250.5') +
        text('E2', 9) +
        number('F2', '0.5', 2),
    ),
    row(
      3,
      text('A3', 6) +
        number('B3', '10002') +
        number('C3', '44197', 1) +
        number('D3', '89.9') +
        text('E3', 10) +
        number('F3', '0.3125', 2),
    ),
    row(
      4,
      text('A4', 7) +
        number('B4', '10001') +
        number('C4', '45292', 1) +
        number('D4', '3200') +
        text('E4', 10) +
        number('F4', '0.75', 2),
    ),
    row(
      5,
      text('A5', 8) +
        number('B5', '10005') +
        number('C5', '45658', 1) +
        number('D5', '17.25') +
        text('E5', 9) +
        number('F5', '0.333', 2),
    ),
  ].join('');
  return zip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml':
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Aufträge" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': sharedXml,
    'xl/styles.xml':
      '<styleSheet><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="20" applyNumberFormat="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  });
}

/** Writes the synthetic export below `root`, inside one wrapper folder. */
export function writeSyntheticExport(root: string): void {
  const base = join(root, 'Export Willert');
  const write = (relativePath: string, content: string | Uint8Array): void => {
    const path = join(base, relativePath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  };
  write('Adressen.csv', windows1252(ADDRESSES));
  write('Kontakte_ohne_Kopf.csv', HEADERLESS);
  write('Auftraege.xlsx', workbook());
  write('Zeiten.xml', XML);
  write('Notizen.csv', NOTES);
  write('Kaputt.xml', '<Export><Kunde><Name>x</Kunde>');
  write('Scans/scan.zeynep', pdf(1));
  write('Artikel/DATANORM.001', windows1252(DATANORM));
  write(
    'Sicherung/sykasoft.bak',
    Uint8Array.from([...'TAPE'].map((character) => character.charCodeAt(0)).concat([0, 1, 2, 3, 0, 0, 7])),
  );
  write('Dokumente/Kunden/Müller Jürgen/Rechnung 2023-001.pdf', pdf(2));
  write('Dokumente/Kunden/Schmidt Erika/Angebot.pdf', pdf(1));
  write('Dokumente/Kunden/Schmidt Erika/Wartung/Protokoll.pdf', pdf(3));
  write('Fotos/Baustelle Hauptstraße 12/IMG_0001.jpg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]));
  write(
    'Fotos/Baustelle Hauptstraße 12/IMG_0002.jpg',
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0, 0]),
  );
  write('Sykasoft/export.cfg', windows1252('[Export]\r\nFelder=KdNr,Name\r\n'));
  write('.DS_Store', Uint8Array.from([0, 0, 0, 1]));
}
