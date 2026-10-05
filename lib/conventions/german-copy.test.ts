import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot, type ProductRoot } from './product-sources';

// User-facing German is written with real umlauts and ß, addresses the user
// with the informal "du", and uses the typographic ellipsis (AGENTS.md,
// "Language" and "1. UI and UX"; UI audit of 2026-10-01). These checks read
// every string literal, template chunk and JSX text of the product tree.

interface ProductString {
  file: string;
  line: number;
  value: string;
  isJsxText: boolean;
}

function productStrings(roots: readonly ProductRoot[]): ProductString[] {
  const strings: ProductString[] = [];
  for (const file of listProductSources(roots)) {
    const source = parseProductSource(file);
    const visit = (node: ts.Node): void => {
      const isImportPath =
        ts.isStringLiteral(node) &&
        (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
      const isTextNode =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node);
      if (isTextNode && !isImportPath && node.text.trim()) {
        strings.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          value: node.text.replace(/\s+/g, ' ').trim(),
          isJsxText: ts.isJsxText(node),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return strings;
}

function offenders(
  strings: readonly ProductString[],
  isOffence: (entry: ProductString) => boolean,
): string[] {
  return strings
    .filter(isOffence)
    .map((entry) => `${entry.file}:${entry.line}: ${entry.value.slice(0, 100)}`);
}

const uiStrings = productStrings(['app', 'components']);
const libStrings = productStrings(['lib', 'hooks']);
const messageModuleStrings = libStrings.filter((entry) => /\/messages\.ts$/.test(entry.file));

// Stems of German words spelled with ae/oe/ue/ss in place of ä/ö/ü/ß. A stem
// list instead of a bare "ae|oe|ue" pattern, because "neue", "aktuell",
// "Dauer", "Quelle", "zuerst" and every English word are legitimate.
const TRANSLITERATED_STEM = new RegExp(
  [
    'fuer',
    'ueber',
    'zurueck',
    'rueck',
    'loesch',
    'loes',
    'aender',
    'pruef',
    'moegl',
    'koenn',
    'muess',
    'waehl',
    'gueltig',
    'fueg',
    'oeffn',
    'schliess',
    'strasse',
    'groess',
    'naechst',
    'naeh',
    'spaet',
    'taetig',
    'geraet',
    'saetz',
    'ergaenz',
    'waehrend',
    'haeuf',
    'faellig',
    'haelt',
    'laeuft',
    'traeg',
    'schlaeg',
    'gaeng',
    'faeng',
    'haeng',
    'kuerz',
    'laeng',
    'hoeh',
    'wuensch',
    'erklaer',
    'buero',
    'stueck',
    'stuetz',
    'schluess',
    'massnahm',
    'gemaess',
    'maessig',
    'ausser',
    'draussen',
    'heiss',
    'gruess',
    'gehoer',
    'stoer',
    'aehnlich',
    'jaehr',
    'taegl',
    'woech',
    'zaehl',
    'plaetz',
  ].join('|'),
  'i',
);
// Identifiers, route slugs and enum values stay ASCII by design
// ("/auftraege/…/uebergabe", 'bestaetigt', 'buero').
const TECHNICAL_TOKEN = /^[a-z0-9_\-./:[\]@#?=&%]+$/;
// Deliberate ASCII outside the technical-token shape. Keep this list short.
const TRANSLITERATION_ALLOWLIST: readonly string[] = [
  // Download file name of the handover export (lib/work-handover/export.ts).
  'Uebergabepaket-',
  // English developer logs naming the Aufträge feature (lib/jobs).
  'Auftraege column preferences',
];

test('German product strings use ä, ö, ü and ß instead of ae, oe, ue and ss', () => {
  expect(
    offenders([...uiStrings, ...libStrings], (entry) => {
      if (!entry.isJsxText && TECHNICAL_TOKEN.test(entry.value)) return false;
      if (TRANSLITERATION_ALLOWLIST.some((allowed) => entry.value.includes(allowed))) return false;
      return entry.value
        .split(/\s+/)
        .some((word) => !TECHNICAL_TOKEN.test(word) && TRANSLITERATED_STEM.test(word));
    }),
  ).toEqual([]);
});

test('user-facing text uses the typographic ellipsis … instead of three dots', () => {
  expect(offenders([...uiStrings, ...messageModuleStrings], (entry) => entry.value.includes('...'))).toEqual(
    [],
  );
});

// "Sie" at the start of a sentence is the pronoun ("Die Datei … Sie erscheint
// nicht …"); after a lowercase word or a comma it is the formal address
// ("Legen Sie", "Bitte wählen Sie"). The possessive "Ihr/Ihre" and "Ihnen"
// are formal in every position the product uses them.
const FORMAL_ADDRESS = /(?<=[a-zäöüß,;] )Sie\b|\b(?:Ihnen|Ihr(?:e[mnrs]?)?)\b/;

test('the app addresses the user with "du", never the formal "Sie" or "Ihr"', () => {
  expect(offenders([...uiStrings, ...libStrings], (entry) => FORMAL_ADDRESS.test(entry.value))).toEqual([]);
});

// Slice, golden-test and audit codes (P1-14, GG-03, A2-06) are planning
// vocabulary that no user knows; "P1-14" reached an empty state (CodeRabbit
// review of 2026-10-03). Product comments may cite them, product text never.
const PLANNING_CODE = /\b(?:P\d+-\d+|GG-\d+|A\d-\d+)\b/;

test('user-facing text names no slice, golden-test or audit code', () => {
  expect(
    offenders([...uiStrings, ...messageModuleStrings], (entry) => PLANNING_CODE.test(entry.value)),
  ).toEqual([]);
});

// German quotation marks open low („) and close high (“). A straight closing
// quote after „ renders as a mismatched pair (rendered review of 2026-10-02).
// Source lines rather than string nodes, because a template literal splits
// `„${name}"` into two chunks; comment lines are skipped.
const MISMATCHED_QUOTE = /„[^“”"\n]*"/;

test('a German quotation that opens with „ closes with “', () => {
  const mismatched: string[] = [];
  for (const file of listProductSources()) {
    readFileSync(resolve(repositoryRoot, file), 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/^\s*(\*|\/\/|\/\*)/.test(line) || !MISMATCHED_QUOTE.test(line)) return;
        mismatched.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
  }
  expect(mismatched).toEqual([]);
});
