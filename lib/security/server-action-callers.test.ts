import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import {
  couldContainServerDirective,
  exportedActions,
  hasServerDirective,
  listApplicationSources,
  repositoryRoot,
} from '@/lib/testing/server-action-inventory';

// Step 3 (2026-09-13) found 27 exported Server Actions with no caller in the
// application: each one was a reachable public POST endpoint that no page,
// component or hook used. An action must be imported by product code or not
// exist; test-only use does not keep a public endpoint alive.
function normalizeModulePath(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith('@/')) target = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    const parts = fromFile.split('/');
    parts.pop();
    for (const segment of specifier.split('/')) {
      if (segment === '.') continue;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    }
    target = parts.join('/');
  } else return null;
  return target.replace(/\.[cm]?[jt]sx?$/, '');
}

type SourceText = { file: string; text: string };

function applicationSourceTexts(): SourceText[] {
  return listApplicationSources().map((file) => ({
    file,
    text: readFileSync(resolve(repositoryRoot, file), 'utf8'),
  }));
}

/** The runtime names each module path is imported or re-exported by; `type` bindings are erased and skipped. */
function importedNamesByModule(sources: readonly SourceText[]): Map<string, Set<string>> {
  const imported = new Map<string, Set<string>>();
  const record = (modulePath: string, name: string): void => {
    const names = imported.get(modulePath) ?? new Set<string>();
    names.add(name);
    imported.set(modulePath, names);
  };
  // A text scan keeps this under the unit timeout: import and re-export statements in
  // this repository are plain `import ... from '...'` / `export { ... } from '...'` forms.
  const statement = /^(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const { file, text } of sources) {
    for (const match of text.matchAll(statement)) {
      const [, , typeOnly, clause, specifier] = match;
      if (typeOnly || clause === undefined || specifier === undefined) continue;
      const modulePath = normalizeModulePath(file, specifier);
      if (!modulePath) continue;
      const bindings = clause.trim();
      if (bindings.startsWith('*')) {
        record(modulePath, '*');
        continue;
      }
      const braces = /\{([^}]*)\}/.exec(bindings);
      const defaultImport = bindings
        .replace(/\{[^}]*\}/, '')
        .replace(/,/g, '')
        .trim();
      if (defaultImport && !defaultImport.startsWith('type')) record(modulePath, 'default');
      for (const entry of braces?.[1]?.split(',') ?? []) {
        const binding = entry.trim();
        // `{ type name }` is erased at runtime, so it calls nothing.
        if (/^type\s/.test(binding)) continue;
        // split() always yields a first element; the fallback only satisfies the index type.
        const name = (binding.split(/\s+as\s+/)[0] ?? '').trim();
        if (name) record(modulePath, name);
      }
    }
  }
  return imported;
}

// A type-only binding inside braces once counted as a caller, so an action
// imported only for its type passed (CodeRabbit on werk-flow/werkflow-app#153).
test('the caller scan counts runtime imports and skips type-only bindings', () => {
  const imported = importedNamesByModule([
    {
      file: 'components/profile/email-form.tsx',
      text: [
        "import { type requestEmailChange, saveProfile as save } from '@/lib/profile/actions';",
        "import type { ProfileInput } from '@/lib/profile/types';",
        "import AvatarUpload, { type AvatarProps } from '../avatar';",
        "export { type deleteAccount, exportData } from '../../lib/account/actions';",
      ].join('\n'),
    },
  ]);
  expect([...(imported.get('lib/profile/actions') ?? [])]).toEqual(['saveProfile']);
  expect(imported.get('lib/profile/types')).toBeUndefined();
  expect([...(imported.get('components/avatar') ?? [])]).toEqual(['default']);
  expect([...(imported.get('lib/account/actions') ?? [])]).toEqual(['exportData']);
});

test('every exported Server Action is imported by product code', () => {
  const sources = applicationSourceTexts();
  const imported = importedNamesByModule(sources);
  const dead: string[] = [];
  for (const { file, text } of sources) {
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (!hasServerDirective(source.statements)) continue;
    const modulePath = file.replace(/\.[cm]?[jt]sx?$/, '');
    const names = imported.get(modulePath) ?? new Set<string>();
    for (const action of exportedActions(file, source)) {
      if (action.name.startsWith('inline:')) continue;
      if (names.has('*') || names.has(action.name)) continue;
      dead.push(`${file}#${action.name}`);
    }
  }
  expect(
    dead,
    'exported Server Actions with no product caller (delete them or wire them: an unused export is still a public POST endpoint)',
  ).toEqual([]);
});
