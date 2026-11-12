import { expect, spyOn, test } from 'bun:test';
import type { ProblemReportContext } from '@/lib/problem-reports/schemas';
import { buildScrubDictionary } from './dictionary';
import { scrubReportContext, scrubReportText } from './scrub-text';

// One test per scrub rule (docs/technical/problem-report-scrubbing.md, "Text
// scrubbing"), named after the rule. The data is synthetic: the customers,
// people, addresses and numbers of a made-up company.

const NO_SOURCES = { customerNames: [], personNames: [], siteNames: [], addresses: [], phones: [] };
// A few of the app's own UI strings, as the build's catalog holds them.
const uiStrings = new Set(['Speichern', 'Service', 'Wartung', 'Hauptstandort', 'Rückruf an Nordlicht']);
const dictionary = buildScrubDictionary(
  {
    customerNames: [
      'Erika Müller',
      'Hausverwaltung Sonnenhang GmbH',
      'Die Bad GmbH',
      'Wei Li',
      'Li Na',
      'Kältetechnik Service Nordlicht',
      "Liam O'Neill",
    ],
    personNames: ['Jonas Weiß', 'Petra von Lindqvist', 'Tom Wartung'],
    siteNames: ['Neubau Kita Regenbogen', 'Werkhalle', 'Hauptstandort', 'Montagehalle (Altbau)'],
    addresses: [
      'Lindenstraße 12a, 54321 Beispielstadt',
      'Am Mühlbach 3\n54322 Musterhausen',
      'Hafenweg 7 54323 Neuhafen',
      'Kirchberg 5, 54324 Altdorf',
    ],
    phones: ['0171 2345678', '+43 664 1234567'],
  },
  uiStrings,
);
const scrub = (text: string): string => scrubReportText(text, dictionary);
const noDictionary = buildScrubDictionary(NO_SOURCES, uiStrings);

// --- Matching rules ---

test('matching rule: case-insensitive', () => {
  expect(scrub('Termin bei erika müller und bei SONNENHANG fehlt.')).toBe(
    'Termin bei [Kunde 1] und bei [Kunde 2] fehlt.',
  );
});

test('matching rule: umlaut and ß spellings', () => {
  expect(scrub('Müller, Mueller, MÜLLER und MUELLER')).toBe('[Kunde 1], [Kunde 1], [Kunde 1] und [Kunde 1]');
  expect(scrub('Weiß, Weiss und WEISS')).toBe('[Person 1], [Person 1] und [Person 1]');
  // A decomposed umlaut, as some keyboards send it, is the same letter.
  expect(scrub('Müller')).toBe('[Kunde 1]');
  expect(scrub('Lindenstraße 12a, Lindenstrasse 12a, Lindenstr. 12a und LINDENSTRASSE 12A')).toBe(
    '[Adresse 1], [Adresse 1], [Adresse 1] und [Adresse 1]',
  );
});

test('matching rule: a known name with an apostrophe matches with each of the three apostrophes', () => {
  expect(scrub("Liam O'Neill, Liam O’Neill und Liam OʼNeill, kurz O’Neill")).toBe(
    '[Kunde 1], [Kunde 1] und [Kunde 1], kurz [Kunde 1]',
  );
});

test('matching rule: a genitive or possessive s', () => {
  expect(scrub('Müllers Heizung, Erika Müllers Therme und Weiß’ Auftrag')).toBe(
    '[Kunde 1] Heizung, [Kunde 1] Therme und [Person 1]’ Auftrag',
  );
  expect(scrub("Müller's Therme")).toBe("[Kunde 1]'s Therme");
});

test('matching rule: a name split by a line break or extra spaces', () => {
  expect(scrub('Auftrag von Erika\nMüller und Jonas    Weiß')).toBe('Auftrag von [Kunde 1] und [Person 1]');
  expect(scrub('Lindenstraße\n12a')).toBe('[Adresse 1]');
});

test('matching rule: phone numbers in any format', () => {
  const formats = [
    '0171 2345678',
    '01712345678',
    '0171/2345678',
    '0171-234 56 78',
    '0171 / 23 45 - 678',
    '+49 171 2345678',
    '+49 (0) 171 2345678',
    '0049 171 2345678',
    '00491712345678',
  ];
  for (const format of formats) expect(scrub(`Tel. ${format} anrufen`)).toBe('Tel. [Telefon 1] anrufen');
  // One number in two formats is one placeholder; another country keeps its own number.
  expect(scrub('0171 2345678 oder +49 171 2345678, sonst 0043 664 1234567')).toBe(
    '[Telefon 1] oder [Telefon 1], sonst [Telefon 2]',
  );
  // A known number is replaced without its leading zero, which no shape rule catches.
  expect(scrub('Durchwahl 171 2345678')).toBe('Durchwahl [Telefon 1]');
  expect(scrubReportText('Durchwahl 171 2345678', noDictionary)).toBe('Durchwahl 171 2345678');
});

test('matching rule: whole words only', () => {
  expect(scrub('Die Müllerstraße, der Weißkopf und die Sonnenhangschule bleiben.')).toBe(
    'Die Müllerstraße, der Weißkopf und die Sonnenhangschule bleiben.',
  );
  expect(scrub('Altmüller und Müllermeister')).toBe('Altmüller und Müllermeister');
});

test('matching rule: a name is replaced as a whole and word by word, except its function words', () => {
  expect(scrub('Hausverwaltung Sonnenhang GmbH, kurz Sonnenhang, hat angerufen.')).toBe(
    '[Kunde 1], kurz [Kunde 1], hat angerufen.',
  );
  // „Die Bad GmbH“ is replaced as a whole and by „Bad“; „die“ and „GmbH“ alone stay.
  expect(scrub('Die Bad GmbH: die Rechnung der GmbH fehlt im Bad.')).toBe(
    '[Kunde 1]: die Rechnung der GmbH fehlt im [Kunde 1].',
  );
  // A two-letter word is replaced only inside its whole name.
  expect(scrub('Wei Li schreibt li. und re.')).toBe('[Kunde 1] schreibt li. und re.');
  expect(scrub('Petra von Lindqvist war da, dann von Petra und von Lindqvist')).toBe(
    '[Person 1] war da, dann von [Person 1] und von [Person 1]',
  );
});

test('matching rule: an address is replaced as street with number and as postcode with city', () => {
  expect(scrub('Einsatz Lindenstraße 12a in 54321 Beispielstadt')).toBe('Einsatz [Adresse 1] in [Adresse 1]');
  expect(scrub('Lindenstr. 12 a und Am Mühlbach 3, 54322 Musterhausen')).toBe(
    '[Adresse 1] und [Adresse 2], [Adresse 2]',
  );
  // An address stored in one piece still splits before its postcode.
  expect(scrub('Hafenweg 7 und 54323 Neuhafen')).toBe('[Adresse 1] und [Adresse 1]');
  // The city without its postcode is not an address.
  expect(scrub('Der Kunde wohnt in Beispielstadt')).toBe('Der Kunde wohnt in Beispielstadt');
});

test('matching rule: a known street is replaced without its number', () => {
  expect(scrub('In der Lindenstraße und am Hafenweg')).toBe('In der [Adresse 1] und am [Adresse 2]');
  // A street of several words is replaced as its phrase.
  expect(scrub('Wir stehen Am Mühlbach und warten')).toBe('Wir stehen [Adresse 1] und warten');
  // A street of one word without a street ending is replaced only with its number.
  expect(scrub('Kirchberg 5 liegt am Kirchberg')).toBe('[Adresse 1] liegt am Kirchberg');
  // A number inside the street's name is not its house number.
  const withNumber = buildScrubDictionary(
    { ...NO_SOURCES, addresses: ['Straße des 17. Juni 5, 54321 Beispielstadt'] },
    uiStrings,
  );
  expect(scrubReportText('Wir stehen in der Straße des 17. Juni vor Nummer 5', withNumber)).toBe(
    'Wir stehen in der [Adresse 1] vor Nummer 5',
  );
});

test('matching rule: a site name is replaced as a whole phrase, never word by word', () => {
  expect(scrub('Im Neubau Kita Regenbogen fehlt der Zähler, im Neubau nebenan und in der Kita nicht.')).toBe(
    'Im [Adresse 1] fehlt der Zähler, im Neubau nebenan und in der Kita nicht.',
  );
  expect(scrub('Die Werkhalle ist zu')).toBe('Die [Adresse 1] ist zu');
  // Punctuation inside a stored name never ends the phrase.
  expect(scrub('In der Montagehalle (Altbau) und in der Montagehalle/Altbau fehlt Licht')).toBe(
    'In der [Adresse 1]) und in der [Adresse 1] fehlt Licht',
  );
  // A site named with one of the app's own UI words is no term: every report would lose the word.
  expect(scrub('Der Hauptstandort fehlt')).toBe('Der Hauptstandort fehlt');
});

test("matching rule: a lone word of a customer's name stays when it is one of the app's own UI words", () => {
  expect(scrub('Der Service lädt nicht, sagt Kältetechnik Service Nordlicht. Nordlicht wartet.')).toBe(
    'Der Service lädt nicht, sagt [Kunde 1]. [Kunde 1] wartet.',
  );
  // Only a whole UI string counts: „Nordlicht“ inside a longer one is still a name, as above.
  // After a salutation the word is a name again.
  expect(scrub('Firma Service wartet')).toBe('Firma [Kunde 1] wartet');
  // A person's name stays strict, UI word or not.
  expect(scrub('Die Wartung fehlt bei Tom Wartung')).toBe('Die [Person 1] fehlt bei [Person 1]');
});

// --- Pattern rules ---

test('pattern rule: any phone-number shape', () => {
  const unknown = (text: string): string => scrubReportText(text, noDictionary);
  expect(unknown('Ruf 030 1234567 an')).toBe('Ruf [Telefon 1] an');
  expect(unknown('Mobil: 0152/98765432, Büro +49 (0) 30 12 34 56-7.')).toBe(
    'Mobil: [Telefon 1], Büro [Telefon 2].',
  );
  expect(unknown('Zimmer 12 0152 98765432')).toBe('Zimmer 12 [Telefon 1]');
  expect(unknown('0041 44 123 45 67 und +43 1 2345678')).toBe('[Telefon 1] und [Telefon 2]');
  // Any Unicode space may group the digits: the narrow no-break space of a
  // formatted number, a thin space, a figure space.
  expect(unknown('Ruf 0171\u202f2345678 an')).toBe('Ruf [Telefon 1] an');
  expect(unknown('Ruf 0171\u2009234\u200756 78 an')).toBe('Ruf [Telefon 1] an');
  // Any number of spaces may group the digits.
  expect(unknown('Ruf 0171   2345678 an')).toBe('Ruf [Telefon 1] an');
  // A number ends where its groups end: no group of it stays readable, even
  // one that starts with a zero, and a second number right behind it goes too.
  expect(unknown('Ruf 0171 234 0567 an')).toBe('Ruf [Telefon 1] an');
  expect(unknown('0171 1234567 0221 987654 221 987655')).toBe('[Telefon 1]');
  // Dates, times, amounts, postcodes and order numbers are no phone numbers.
  const kept =
    'Am 01.02.2026 um 08:30, 12 Stück zu 0,50 Euro, Auftrag 2026-0042 in 01067 Dresden, 3 von 15, DN 20';
  expect(unknown(kept)).toBe(kept);
});

test('pattern rule: any email address', () => {
  expect(scrub('Mail an erika.mueller@beispiel-bad.example oder INFO@Sonnenhang.example.')).toBe(
    'Mail an [E-Mail 1] oder [E-Mail 2].',
  );
  expect(scrub('jonas+test@firma.example, Jonas+Test@Firma.example')).toBe('[E-Mail 1], [E-Mail 1]');
  // A letter of the address may carry a combining mark that no precomposed letter covers.
  expect(scrub('Mail an q\u0307uentin@beispi\u0307el.example')).toBe('Mail an [E-Mail 1]');
  // A local part may hold an apostrophe, and in quotes a space.
  expect(scrub("Mail an anne.o'neill@beispiel.example")).toBe('Mail an [E-Mail 1]');
  expect(scrub('Mail an "anna meier"@beispiel.example und "sag @alle"')).toBe(
    'Mail an [E-Mail 1] und "sag @alle"',
  );
  expect(scrub('Mail an "anna\\"meier"@beispiel.example')).toBe('Mail an [E-Mail 1]');
  expect(scrub('Preis @ 12 Euro und @home bleiben')).toBe('Preis @ 12 Euro und @home bleiben');
});

test('pattern rule: any IBAN', () => {
  expect(scrub('IBAN DE89 3704 0044 0532 0130 00 bitte prüfen')).toBe('IBAN [IBAN 1] bitte prüfen');
  expect(scrub('DE89370400440532013000 und de89 3704 0044 0532 0130 00')).toBe('[IBAN 1] und [IBAN 1]');
  expect(scrub('Konto GB82 WEST 1234 5698 7654 32 und AT61 1904 3002 3457 3201.')).toBe(
    'Konto [IBAN 1] und [IBAN 2].',
  );
  // Any Unicode space may separate the groups.
  expect(scrub('IBAN DE89\u202f3704\u202f0044\u202f0532\u202f0130\u202f00 ok')).toBe('IBAN [IBAN 1] ok');
  expect(scrub('IBAN DE89\u20093704\u20090044\u20090532\u20090130\u200900 ok')).toBe('IBAN [IBAN 1] ok');
  // A mistyped number fails its check and is replaced by its shape.
  expect(scrub('DE89 3704 0044 0532 0130 01')).toBe('[IBAN 1]');
  // A product code with a number is no IBAN.
  expect(scrub('Rohr DN20 3000 mm und WP12 Kessel defekt')).toBe('Rohr DN20 3000 mm und WP12 Kessel defekt');
});

test('salutation rule: a capitalized name after a salutation is replaced even when the dictionary does not know it', () => {
  const unknown = (text: string): string => scrubReportText(text, noDictionary);
  expect(unknown('Frau Berger rief an, Herr Okafor auch.')).toBe(
    'Frau [Person 1] rief an, Herr [Person 2] auch.',
  );
  expect(unknown('bei Herrn Tobias Anders war ich, Familie Zeller kommt.')).toBe(
    'bei Herrn [Person 1] war ich, Familie [Person 2] kommt.',
  );
  expect(unknown('Fam. Zeller, Firma Rohrfrei Nord und Fa. Kaltwasser')).toBe(
    'Fam. [Person 1], Firma [Kunde 1] und Fa. [Kunde 2]',
  );
  // A hyphenated double name is one word; a title before the name is skipped.
  expect(unknown('Frau Meier-Lüdenscheidt Sommer hat, Herr Prof. Dr. Albers auch')).toBe(
    'Frau [Person 1] hat, Herr Prof. Dr. [Person 2] auch',
  );
  // The same name takes the same placeholder; a function word is no name.
  expect(unknown('Frau Berger und Frau Berger, die Frau vom Kunden')).toBe(
    'Frau [Person 1] und Frau [Person 1], die Frau vom Kunden',
  );
  // A sentence ends the name.
  expect(unknown('Ich war bei Frau Berger. Termin fehlt.')).toBe(
    'Ich war bei Frau [Person 1]. Termin fehlt.',
  );
  // A known first name before an unknown surname leaves neither readable.
  expect(scrub('Frau Erika Unbekannt')).toBe('Frau [Kunde 1]');
});

test('salutation rule: a lower-case word after a salutation is the name, unless it is a function word or an auxiliary', () => {
  const unknown = (text: string): string => scrubReportText(text, noDictionary);
  expect(unknown('war bei frau berger, dann bei herrn okafor')).toBe(
    'war bei frau [Person 1], dann bei herrn [Person 2]',
  );
  // One word only, with the parts of a hyphenated name; a title is skipped.
  expect(unknown('frau meier-lüdenscheidt sommer, fa. rohrfrei nord, frau dr. albers')).toBe(
    'frau [Person 1] sommer, fa. [Kunde 1] nord, frau dr. [Person 2]',
  );
  // An apostrophe joins the parts of a name like a hyphen, with any of the three apostrophes.
  expect(unknown("Frau O’Neill, Herr D'Angelo und Frau OʼBrien")).toBe(
    'Frau [Person 1], Herr [Person 2] und Frau [Person 3]',
  );
  expect(unknown('frau o’neill rief an')).toBe('frau [Person 1] rief an');
  // A possessive after a capitalized name is no part of it.
  expect(unknown('Frau Berger’s Bad')).toBe('Frau [Person 1]’s Bad');
  // A company's name may hold a digit.
  expect(unknown('firma rohrfrei24 und herr 24')).toBe('firma [Kunde 1] und herr 24');
  // The same person with and without the capital.
  expect(unknown('Frau Berger, frau berger')).toBe('Frau [Person 1], frau [Person 1]');
  // What a sentence goes on with is no name.
  const kept =
    'die frau hat angerufen, der herr vom amt ist da, die firma möchte einen termin, die familie und wir';
  expect(unknown(kept)).toBe(kept);
});

// --- Placeholders ---

test('placeholders are typed and stable within one text', () => {
  expect(
    scrub(
      'Jonas Weiß war bei Erika Müller, Lindenstraße 12a. Müller hat Weiß unter 0171 2345678 ' +
        'und erika@beispiel.example erreicht. Danach rief Jonas bei Sonnenhang an.',
    ),
  ).toBe(
    '[Person 1] war bei [Kunde 1], [Adresse 1]. [Kunde 1] hat [Person 1] unter [Telefon 1] ' +
      'und [E-Mail 1] erreicht. Danach rief [Person 1] bei [Kunde 2] an.',
  );
});

test('overlapping finds merge, so no part of either stays readable', () => {
  // Two known names that share a word: „Wei Li“ and „Li Na“.
  expect(scrub('Wei Li Na war da')).toBe('[Kunde 1] war da');
  // The address inside the email, and the IBAN's digits that look like a phone number.
  expect(scrub('mueller@sonnenhang.example')).toBe('[E-Mail 1]');
  expect(scrub('DE89 3704 0044 0532 0130 00')).toBe('[IBAN 1]');
});

// --- Linear time ---

test('10,000 customers: the scrub walks the text once, whatever the size of the dictionary', () => {
  const letters = (index: number): string =>
    Array.from(index.toString(26), (digit) => String.fromCharCode(97 + Number.parseInt(digit, 26))).join('');
  const customer = (index: number): string => `Vor${letters(index)} Nach${letters(index + 20_000)}`;
  const large = buildScrubDictionary(
    { ...NO_SOURCES, customerNames: Array.from({ length: 10_000 }, (_, index) => customer(index)) },
    uiStrings,
  );
  const sentence = (index: number): string =>
    `Bei ${customer(index * 97)} tropft das Ventil seit gestern wieder, bitte den Termin neu planen. `;
  const text = Array.from({ length: 50 }, (_, index) => sentence(index)).join('');
  const words = text.split(/\s+/u).filter(Boolean).length;

  const lookups = spyOn(Map.prototype, 'get');
  const scrubbed = scrubReportText(text, large);
  const count = lookups.mock.calls.length;
  lookups.mockRestore();

  expect(scrubbed).toBe(
    Array.from(
      { length: 50 },
      (_, index) =>
        `Bei [Kunde ${index + 1}] tropft das Ventil seit gestern wieder, bitte den Termin neu planen. `,
    ).join(''),
  );
  // Each word starts at most a few lookups in the tree, and the tree is the
  // only way to a name: the count follows the words of the text, never the
  // 10,000 names. A loop over the names would need at least one step per name.
  expect(count).toBeGreaterThanOrEqual(words);
  expect(count).toBeLessThan(2 * words);
});

test('one pass: a name of a hundred words is replaced whole, and no word of the text starts a walk that long', () => {
  // The longest customer name the app stores: 99 times „Li“ and one more word.
  const longName = `${'Li '.repeat(99)}Xyz`;
  const long = buildScrubDictionary({ ...NO_SOURCES, customerNames: [longName] }, uiStrings);
  expect(scrubReportText(`Kunde ${longName} ruft an`, long)).toBe('Kunde [Kunde 1] ruft an');

  const words = 1667;
  const text = Array.from({ length: words }, () => 'Li').join(' ');
  const lookups = spyOn(Map.prototype, 'get');
  scrubReportText(text, long);
  const count = lookups.mock.calls.length;
  lookups.mockRestore();
  // A walk ends after the twelve words a stretch of a term has.
  expect(count).toBeLessThan(14 * words);
});

// --- Context ---

const context: ProblemReportContext = {
  routeTemplate: '/kunden/[clientId]',
  recentActions: [
    { routeTemplate: '/kunden', controlLabel: 'Erika Müller' },
    { routeTemplate: '/kunden/[clientId]', controlLabel: 'Speichern' },
    { routeTemplate: '/kunden/[clientId]', controlLabel: 'Speichern bei Erika Müller' },
    { routeTemplate: '/kunden/[clientId]', controlLabel: null },
  ],
  clientErrors: [{ name: 'TypeError', code: null, digest: '4711', routeTemplate: '/kunden/[clientId]' }],
  appVersion: 'a1b2c3d4e5f6',
  device: { platform: 'android', browser: 'chrome', viewport: { width: 412, height: 915 } },
  offline: false,
};

test("context rule: a control label that is not one of the app's own UI strings is removed on the server", () => {
  const scrubbed = scrubReportContext(context, uiStrings, dictionary);
  expect(scrubbed.recentActions.map((action) => action.controlLabel)).toEqual([
    null,
    'Speichern',
    null,
    null,
  ]);
  expect(JSON.stringify(scrubbed)).not.toContain('Müller');
  expect({ ...scrubbed, recentActions: [] }).toEqual({ ...context, recentActions: [] });
});

test('context rule: a token that the dictionary knows as a name or a phone number is removed', () => {
  const routeTemplate = '/kunden/[clientId]';
  // What a crafted client could send in the fields an honest one fills from the build and from errors.
  const crafted: ProblemReportContext = {
    ...context,
    appVersion: 'Erika.Mueller',
    clientErrors: [
      { name: 'TypeError', code: 'load_failed', digest: '0123456789', routeTemplate },
      { name: 'Jonas_Weiss', code: '+491712345678', digest: '0171-2345678', routeTemplate },
    ],
  };
  const scrubbed = scrubReportContext(crafted, uiStrings, dictionary);
  expect(scrubbed.appVersion).toBeNull();
  // No pattern rule applies to a token: the numeric digest has a phone number's shape and stays.
  expect(scrubbed.clientErrors).toEqual([
    { name: 'TypeError', code: 'load_failed', digest: '0123456789', routeTemplate },
    { name: null, code: null, digest: null, routeTemplate },
  ]);
  expect(scrubReportContext(context, uiStrings, dictionary).appVersion).toBe('a1b2c3d4e5f6');
});

test('context rule: a token that holds a record id is removed', () => {
  const routeTemplate = '/auftraege/[jobNumber]';
  const recordId = '7c1e2d3f-0000-4000-8000-00000000abcd';
  const crafted: ProblemReportContext = {
    ...context,
    appVersion: `org-${recordId}`,
    clientErrors: [
      { name: 'TypeError', code: `missing:${recordId}`, digest: recordId.toUpperCase(), routeTemplate },
      { name: 'TypeError', code: 'load_failed', digest: '0123456789', routeTemplate },
    ],
  };
  const scrubbed = scrubReportContext(crafted, uiStrings, dictionary);
  expect(JSON.stringify(scrubbed).toLowerCase()).not.toContain(recordId);
  expect(scrubbed.appVersion).toBeNull();
  expect(scrubbed.clientErrors).toEqual([
    { name: 'TypeError', code: null, digest: null, routeTemplate },
    { name: 'TypeError', code: 'load_failed', digest: '0123456789', routeTemplate },
  ]);
});

test('pattern rule: any record id, also inside a longer word', () => {
  const organizationId = '7c1e2d3f-0000-4000-8000-00000000abcd';
  const text = `Organisation: ${organizationId}, Link /kunden/${organizationId.toUpperCase()}x und ref-1f2e3d4c-5b6a-4789-8a7b-6c5d4e3f2a1b.`;
  expect(scrubReportText(text, dictionary)).toBe(
    'Organisation: [ID 1], Link /kunden/[ID 1]x und ref-[ID 2].',
  );
});
