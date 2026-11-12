import type { DatanormFile } from '@/lib/inventory/datanorm/types';

// Synthetic DATANORM 4 deliveries of a made-up wholesaler, "Großhandel
// Nordrohr". Every article, number and price is invented. The files are
// written in code page 850 as a wholesaler's would be.

const CP850_BYTES: Record<string, number> = {
  ä: 0x84,
  ö: 0x94,
  ü: 0x81,
  Ä: 0x8e,
  Ö: 0x99,
  Ü: 0x9a,
  ß: 0xe1,
  '°': 0xf8,
};

function cp850File(name: string, lines: readonly string[]): DatanormFile {
  const bytes = [...lines.join('\r\n')].map((character) => {
    const code = character.charCodeAt(0);
    if (code < 0x80) return code;
    const byte = CP850_BYTES[character];
    if (byte === undefined) throw new Error(`The fixture has no code page 850 byte for "${character}".`);
    return byte;
  });
  return { name, bytes: Uint8Array.from(bytes) };
}

/** A fixed-width DATANORM 4 header: "V", a space, DDMMYY, free text, version and currency in 128 characters. */
function header(date: string, text: string, version = '04'): string {
  return `V ${date}${text.padEnd(115, ' ')}${version}EUR`;
}

const NORDROHR = header('120526', 'Großhandel Nordrohr GmbH   Katalog Sanitär und Heizung');

/** A clean delivery: articles over two files, a price file, product groups and rebate groups. */
export function nordrohrDelivery(): DatanormFile[] {
  return [
    cp850File('DATANORM.002', [
      NORDROHR,
      'A;A;NR-1004;00;Heizkörperventil;Thermostat DN 15;1;1;Stk;15990;AR;20;',
      'B;N;NR-1002;PRESSBOGEN15;;;;4006501000024;;1020;;;',
    ]),
    cp850File('DATANORM.001', [
      NORDROHR,
      'A;N;NR-1001;00;Kupferrohr 15 mm;Stange 5 m;1;0;m;1290;KU;10;',
      'B;N;NR-1001;KUPFERROHR15;;;;4006501000017;;1010;;;',
      'T;N;NR-1001;1;Langtext zum Kupferrohr;',
      'A;N;NR-1002;00;Pressbogen 90°;15 mm;2;2;Stk;48750;PF;10;',
      'A;N;NR-1003;00;Kugelhahn DN 15;Messing;1;0;Stk;0;AR;20;',
      'A;L;NR-0999;;;;;;;;;;',
      '',
    ]),
    cp850File('DATPREIS.001', [
      NORDROHR,
      'P;A;NR-1001;2;1150;1;1500;;;;;NR-1003;1;2450;0;KU;;;;;NR-1004;2;14990;;;;;;',
      'P;P;NR-1002;2;;;;;;;;',
    ]),
    cp850File('DATANORM.WRG', [NORDROHR, 'S;;10;Rohre und Fittings;;;', 'S;;10;;1010;Kupferrohr;']),
    cp850File('DATANORM.RAB', [NORDROHR, 'R;;KU;1;2500;Kupfer;', 'R;;PF;1;3250;Pressfittings;']),
  ];
}

/** A delivery with one broken line or file of each refused kind, beside one readable article. */
export function brokenNordrohrDelivery(): DatanormFile[] {
  return [
    cp850File('DATANORM.001', [
      NORDROHR,
      'A;N;NR-2001;00;Muffe 15 mm',
      'A;N;NR-2002;00;Muffe 22 mm;;1;0;Stk;12,50;KU;10;',
      'A;N;NR-2003;00;Muffe 28 mm;;1;5;Stk;1250;KU;10;',
      'A;N;NR-2004;00;Muffe 35 mm;;1;0;Bund;1250;KU;10;',
      'P;A;NR-2004;1;abc;;;;;;;',
      '1A;N;NR-2005;00;Muffe 42 mm;;1;0;Stk;1250;KU;10;',
    ]),
    cp850File('DATANORM.002', ['A;N;NR-2006;00;Muffe 54 mm;;1;0;Stk;1250;KU;10;']),
    cp850File('DATPREIS.001', ['V;050;Großhandel Nordrohr GmbH;', 'P;A;NR-2004;1;990;;;;;;;']),
    cp850File('DATANORM.WRG', [header('120526', 'Großhandel Nordrohr GmbH', '03'), 'S;;10;Rohre;;;']),
    cp850File('Preisliste.csv', ['Artikel;Preis']),
  ];
}
