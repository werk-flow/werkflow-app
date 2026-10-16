import { describe, expect, test } from 'bun:test';

import { moduleHelpers, moduleTypes, renamedCopies, sharedNames } from './duplicate-detection';
import { listProductSources } from './product-sources';

// Tier 2 for the one-home rule (AGENTS.md coding standards). A module-level
// helper name declared in two or more product files is a copy until proven
// otherwise. The names below are the known copies with their copy count; a
// count may only fall, and a name leaves the list with its last copy.
// A new shared name, or a known one with a new copy, fails here with the files.

const KNOWN_DUPLICATE_HELPERS: Readonly<Record<string, number>> = {};

// A body shorter than this many tokens is a trivial one-liner (a property read,
// a constant) whose repetition is not a copied rule; longer identical bodies are copies.
const MIN_COPIED_BODY_TOKENS = 12;
// With identifiers erased, short bodies match by shape alone: below this
// length the matches on the product tree were thin wrappers over different
// data (two badges, two guards); from it on, an equal shape is a copied rule.
const MIN_ERASED_BODY_TOKENS = 40;
// A shorter type body is a one- or two-field record that many concepts share.
const MIN_COPIED_TYPE_TOKENS = 20;

const productFiles = listProductSources().filter((file) => !file.endsWith('/route.ts'));
const helpers = productFiles.flatMap((file) => moduleHelpers(file));
const types = productFiles.flatMap((file) => moduleTypes(file));

/** A known-copy list may only shrink: new groups fail, and so do entries whose copies are gone. */
function expectKnownCopies(
  found: ReadonlyMap<string, readonly { name: string; file: string }[]>,
  known: Readonly<Record<string, string>>,
  listName: string,
  fix: string,
): void {
  const unknown = [...found].filter(([key]) => !(key in known));
  expect(
    unknown.map(([, copies]) => copies.map((copy) => `${copy.name} (${copy.file})`).join(' = ')),
    fix,
  ).toEqual([]);
  expect(
    Object.keys(known).filter((key) => !found.has(key)),
    `These copies are gone; remove them from ${listName} so the list only shrinks.`,
  ).toEqual([]);
}

test('a module-level helper name is declared in one product file unless it is a known copy', () => {
  const duplicated = sharedNames(helpers);
  const grown = [...duplicated].filter(
    ([name, files]) => files.length > (KNOWN_DUPLICATE_HELPERS[name] ?? 1),
  );
  expect(
    grown.map(([name, files]) => `${name}: ${files.join(', ')}`),
    'One home per helper: move the shared implementation into the owning lib module and import it (AGENTS.md coding standards). Same-name helpers with genuinely different meaning need different names.',
  ).toEqual([]);
  const shrunk = Object.entries(KNOWN_DUPLICATE_HELPERS).filter(
    ([name, count]) => (duplicated.get(name)?.length ?? 1) < count,
  );
  expect(
    shrunk.map(([name]) => name),
    'These names have fewer copies than KNOWN_DUPLICATE_HELPERS records; lower the count or remove the name so the list only shrinks.',
  ).toEqual([]);
}, 60_000);

// Known copies of the checks below, keyed by their sorted names joined by
// " = ", each with the reason it stays. An entry leaves its list with its last copy.
const KNOWN_RENAMED_COPIES: Readonly<Record<string, string>> = {};
const KNOWN_ERASED_COPIES: Readonly<Record<string, string>> = {};
const KNOWN_DUPLICATE_TYPES: Readonly<Record<string, string>> = {};
const KNOWN_RENAMED_TYPES: Readonly<Record<string, string>> = {
  'AssignmentEmployeeRow = ConflictEmployeeRecord':
    'Each Pick names the columns its own read selects from employee_records; the generated row type is the home.',
};

// The same rule for a copy that was renamed: two helpers with token-identical
// parameters and bodies under different names. Same-name copies are the
// first test's business.
test('no helper body is copied under another name', () => {
  expectKnownCopies(
    renamedCopies(helpers, (helper) =>
      helper.tokenCount < MIN_COPIED_BODY_TOKENS ? undefined : helper.body,
    ),
    KNOWN_RENAMED_COPIES,
    'KNOWN_RENAMED_COPIES',
    'Identical helper bodies under different names: keep one in its owning module and import it.',
  );
}, 60_000);

// A copy that renamed its parameters, its locals or the module data it reads
// is still a copy: equal parameters and bodies once every identifier but a
// member name is erased.
test('no helper body is copied with its identifiers renamed', () => {
  expectKnownCopies(
    renamedCopies(helpers, (helper) =>
      helper.tokenCount < MIN_ERASED_BODY_TOKENS ? undefined : helper.erasedBody,
    ),
    KNOWN_ERASED_COPIES,
    'KNOWN_ERASED_COPIES',
    'Helper bodies equal up to their identifiers: keep one implementation in its owning module and pass the part that differs as a parameter.',
  );
}, 60_000);

// One home per shared type: an exported type alias or interface name is
// declared in one product file. A local type stays private to its file.
test('an exported type name is declared in one product file', () => {
  const duplicated = sharedNames(types.filter((type) => type.exported));
  expectKnownCopies(
    new Map([...duplicated].map(([name, files]) => [name, files.map((file) => ({ name, file }))] as const)),
    KNOWN_DUPLICATE_TYPES,
    'KNOWN_DUPLICATE_TYPES',
    'One home per type: export it from its owning module and import it there; a type with another meaning needs another name.',
  );
}, 60_000);

test('no type body is copied under another name', () => {
  expectKnownCopies(
    renamedCopies(types, (type) => (type.tokenCount < MIN_COPIED_TYPE_TOKENS ? undefined : type.body)),
    KNOWN_RENAMED_TYPES,
    'KNOWN_RENAMED_TYPES',
    'Identical type bodies under different names: declare the type once and import it, or alias it where the second name says more.',
  );
}, 60_000);

describe('duplicate detection probes', () => {
  const sumBody = (name: string, values: string, entry: string): string =>
    `export function ${name}(${values}: Entry[]): number {\n  let total = 0;\n  for (const ${entry} of ${values}) {\n    if (${entry}.minutes > 0) total += ${entry}.minutes;\n    else total += ${entry}.fallbackMinutes ?? 0;\n  }\n  return total;\n}\n`;

  test('a helper copied with renamed parameters and locals is caught; a mapper over other fields is not', () => {
    const copies = [
      ...moduleHelpers('lib/a.ts', sumBody('sumMinutes', 'entries', 'entry')),
      ...moduleHelpers('lib/b.ts', sumBody('totalOf', 'rows', 'row')),
      ...moduleHelpers('lib/c.ts', sumBody('sumMinutes', 'items', 'item').replaceAll('minutes', 'seconds')),
    ];
    expect(copies[0]?.tokenCount).toBeGreaterThanOrEqual(MIN_ERASED_BODY_TOKENS);
    const erased = renamedCopies(copies, (helper) => helper.erasedBody);
    expect([...erased.keys()]).toEqual(['sumMinutes = totalOf']);
    expect(erased.get('sumMinutes = totalOf')?.map((helper) => helper.file)).toEqual([
      'lib/a.ts',
      'lib/b.ts',
    ]);
    expect([...renamedCopies(copies, (helper) => helper.body).keys()]).toEqual([]);
  });

  test('an exported type name in two files is caught; a local one is not', () => {
    const declared = [
      ...moduleTypes(
        'lib/a.ts',
        "export type OrgRole = 'admin' | 'buero' | 'employee';\ntype Props = { id: string };\n",
      ),
      ...moduleTypes(
        'components/b.tsx',
        "export type OrgRole = 'admin' | 'employee';\ntype Props = { name: string };\n",
      ),
      ...moduleTypes('hooks/c.ts', "type OrgRole = 'admin';\nexport type { OrgRole };\n"),
    ];
    expect([...sharedNames(declared.filter((type) => type.exported))]).toEqual([
      ['OrgRole', ['lib/a.ts', 'components/b.tsx', 'hooks/c.ts']],
    ]);
  });

  test('a type body copied under another name is caught, as alias and as interface', () => {
    const record = '{ id: string; name: string; email: string | null; role: OrgRole; active: boolean }';
    const declared = [
      ...moduleTypes('lib/a.ts', `export type MemberInfo = ${record};\n`),
      ...moduleTypes('lib/b.ts', `export type CalendarMember = ${record};\n`),
      ...moduleTypes('lib/c.ts', `export interface OtherMember ${record}\n`),
    ];
    expect(declared[0]?.tokenCount).toBeGreaterThanOrEqual(MIN_COPIED_TYPE_TOKENS);
    expect([...renamedCopies(declared, (type) => type.body).keys()]).toEqual([
      'CalendarMember = MemberInfo = OtherMember',
    ]);
  });
});
