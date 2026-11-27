// Rule test: a change plan selects the layout sweeps whose audited pages, tabs and dialogs render a changed product file, and a shared control selects none.
import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sourceImportGraph } from '../evidence/group-evidence';
import { renderedSurfaceFiles, SHARED_SURFACE_LIMIT, surfaceRoots } from './surface-closure';
import { SURFACE_GROUPS, surfaceTests } from './surface-groups';

const ROOT = resolve(import.meta.dir, '../../..');
const ROOTS = surfaceRoots(ROOT);
const FILES = ['app', 'components', 'hooks', 'lib'].flatMap((directory) =>
  [...new Glob('**/*').scanSync({ cwd: join(ROOT, directory), onlyFiles: true })].map(
    (file) => `${directory}/${file.replaceAll('\\', '/')}`,
  ),
);
const RENDERED = renderedSurfaceFiles(sourceImportGraph(ROOT, FILES, [...ROOTS.values()].flat()), ROOTS);
const sweepsOf = (file: string): string[] =>
  [...RENDERED].filter(([, files]) => files.includes(file)).map(([group]) => group);

test('every audited page and dialog selects the sweep that audits it', () => {
  for (const group of SURFACE_GROUPS) {
    const rendered = RENDERED.get(`audit:layout:${group}`) ?? [];
    for (const piece of surfaceTests(group)) {
      // A route the inventory names without its page would select nothing, so the next page could fall outside.
      if (piece.defaultView) {
        const page = `app/(app)${piece.route}/page.tsx`;
        expect(existsSync(join(ROOT, page)), `${piece.route} has ${page}`).toBe(true);
        expect(rendered, `${group} renders ${page}`).toContain(page);
      }
      for (const dialog of piece.dialogs) {
        const component = dialog.key.slice(0, dialog.key.indexOf('#'));
        expect(existsSync(join(ROOT, component)), `${dialog.opener} lives in ${component}`).toBe(true);
        expect(rendered, `${group} renders ${component}`).toContain(component);
      }
    }
  }
});

test('the job pages and the edit dialog of #393 select the job sweep', () => {
  expect(sweepsOf('components/auftraege/job-detail/job-detail-header.tsx')).toContain('audit:layout:job');
  expect(sweepsOf('components/auftraege/forms/edit-job-dialog.tsx')).toContain('audit:layout:job');
});

test('a shared control selects no sweep, and the data layer and tests select none', () => {
  for (const file of ['components/ui/button.tsx', 'components/ui/dialog.tsx'])
    expect(sweepsOf(file), `${file} is rendered by more than ${SHARED_SURFACE_LIMIT} sweeps`).toEqual([]);
  for (const files of RENDERED.values())
    expect(files.filter((file) => !/^(?:app|components|hooks)\//.test(file))).toEqual([]);
});
