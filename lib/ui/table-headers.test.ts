// Rule test: every table column has a header a screen reader can name.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// An empty `<th>` fails axe's empty-table-header rule: the action, selection
// and expand columns of seven tables had none (standalone and page-structure
// axe pass, 2026-10-17). A column without a visible title takes
// `hiddenHeader(label)` from components/ui/skeleton-table.tsx.

const root = resolve(import.meta.dir, '../..');

/** The empty header spellings of a source, as `line: text`. */
function emptyHeaders(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line, index) =>
      /\bheader:\s*(null|''|""|``)\s*[,}]/.test(line) || /<TableHead\b[^>]*\/>/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    );
}

test('no column definition or table head renders an empty header cell', () => {
  const findings = ['app', 'components'].flatMap((directory) =>
    readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })
      .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) =>
        emptyHeaders(readFileSync(resolve(root, file), 'utf8')).map((hit) => `${file}:${hit}`),
      ),
  );
  expect(findings).toEqual([]);
});

test('probe: null, empty and self-closing headers are found, a hidden header is not', () => {
  expect(emptyHeaders("{ id: 'actions', header: null, className: 'w-10' },")).toHaveLength(1);
  expect(emptyHeaders("  header: '',")).toHaveLength(1);
  expect(emptyHeaders('<TableHead key={column.id} className={column.className} />')).toHaveLength(1);
  expect(emptyHeaders("{ id: 'actions', header: hiddenHeader('Aktionen') },")).toEqual([]);
});
