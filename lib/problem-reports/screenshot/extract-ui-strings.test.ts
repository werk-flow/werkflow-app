import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { collectUiStringCatalog } from './extract-ui-strings';

const COMPONENT = `
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
const LABELS = { open: 'Offen', done: \`Erledigt\` } as const;
export function Example({ count }: { count: number }) {
  return (
    <section className="flex items-center gap-2" title="Auftrag bearbeiten">
      <h3 className={cn('text-sm', count > 1 && 'font-medium')}>
        Neuer
        Auftrag
      </h3>
      <Button aria-label="Speichern und schließen">{count} Aufträge</Button>
      <span>{'0800 123 456'}</span>
      <span>{\`\${count} offen\`}</span>
      <p>Bitte prüfe die Adresse, bevor du speicherst.</p>
    </section>
  );
}
`;

const roots: string[] = [];

/** A fresh repository root with the given files; app/, components/ and lib/ always exist. */
function repositoryWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-string-catalog-'));
  roots.push(root);
  for (const folder of ['app', 'components', 'lib']) mkdirSync(join(root, folder));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('extracting UI strings from one source', () => {
  const strings = collectUiStringCatalog(repositoryWith({ 'components/example.tsx': COMPONENT }), {});

  test('takes string literals, JSX attribute strings and JSX text, whitespace collapsed', () => {
    expect(strings).toEqual(
      expect.arrayContaining([
        'Offen',
        'Erledigt',
        'Auftrag bearbeiten',
        'Neuer Auftrag',
        'Speichern und schließen',
        'Aufträge',
        'Bitte prüfe die Adresse, bevor du speicherst.',
      ]),
    );
  });

  test('keeps each literal whole, so a word of a sentence never enters alone', () => {
    expect(strings).not.toContain('Adresse');
    expect(strings).not.toContain('Speichern');
  });

  test('skips module paths, class names and texts without a letter', () => {
    for (const skipped of [
      '@/components/ui/button',
      'flex items-center gap-2',
      'text-sm',
      'font-medium',
      '0800 123 456',
    ])
      expect(strings).not.toContain(skipped);
  });

  test('skips the parts of an interpolated template', () => {
    expect(strings).not.toContain('offen');
  });
});

test('the catalog reads app, components and lib, sorted and unique, without tests, test data or declarations', () => {
  const root = repositoryWith({
    'app/page.tsx': `export default function Page() { return <h1>Übersicht</h1>; }`,
    'components/list.tsx': `export const EMPTY = 'Noch keine Aufträge';`,
    'lib/messages.ts': `export const SAVED = 'Gespeichert'; export const AGAIN = 'Übersicht';`,
    'lib/messages.test.ts': `const name = 'Erika Testperson';`,
    'lib/testing/fixtures/world.ts': `export const OWNER = 'Jonas Fixturemann';`,
    'components/kunden/fixtures/sample.ts': `export const CITY = 'Fixturehausen';`,
    'tests/golden/steps.ts': `export const STREET = 'Testweg 4';`,
    'lib/types.d.ts': `declare const label: 'Deklariert';`,
  });
  expect(collectUiStringCatalog(root, {})).toEqual(['Gespeichert', 'Noch keine Aufträge', 'Übersicht']);
});

describe('example values and data lists stay out', () => {
  const root = repositoryWith({
    'components/name-field.tsx': `export const Field = () => <Input placeholder="Mustermann" aria-label="Nachname" />;`,
    'components/search.ts': `export const SEARCH = { placeholder: 'Musterstraße 1', label: 'Adresse' };`,
    'lib/regions.ts': `export const REGION_LABELS = { HH: 'Hamburg', HB: 'Bremen' };\nexport const TITLE = 'Bundesland';`,
  });

  test('a placeholder literal is an example value and never enters the catalog', () => {
    const strings = collectUiStringCatalog(root, { 'lib/regions.ts': ['REGION_LABELS'] });
    expect(strings).not.toContain('Mustermann');
    expect(strings).not.toContain('Musterstraße 1');
    expect(strings).toEqual(expect.arrayContaining(['Nachname', 'Adresse']));
  });

  test('the literals of a listed data list never enter the catalog; the rest of its file does', () => {
    const strings = collectUiStringCatalog(root, { 'lib/regions.ts': ['REGION_LABELS'] });
    expect(strings).not.toContain('Hamburg');
    expect(strings).not.toContain('Bremen');
    expect(strings).toContain('Bundesland');
  });

  test('a listed data list that no longer exists fails the build', () => {
    expect(() => collectUiStringCatalog(root, { 'lib/regions.ts': ['RENAMED_LABELS'] })).toThrow(
      'lib/regions.ts#RENAMED_LABELS',
    );
  });

  test("the app's own catalog holds no lone city or example name", () => {
    const strings = collectUiStringCatalog(resolve(import.meta.dir, '../../..'));
    for (const value of ['Hamburg', 'Berlin', 'Bremen', 'Mustermann', 'Max', 'Erika', 'Musterfrau'])
      expect(strings).not.toContain(value);
  });
});
