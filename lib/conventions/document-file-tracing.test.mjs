import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from './product-sources';
import picomatch from 'next/dist/compiled/picomatch';

// Rule test: Tier 2 prevention of assets omitted from the deployed function bundle.
// Parse the config instead of running its build-time service worker and UI catalog generators.
const config = ts.createSourceFile(
  'next.config.ts',
  readFileSync(resolve(repositoryRoot, 'next.config.ts'), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const includes = [];
function collectIncludes(node) {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText(config) === 'outputFileTracingIncludes' &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    for (const entry of node.initializer.properties) {
      if (!ts.isPropertyAssignment(entry) || !ts.isStringLiteral(entry.name)) continue;
      expect(
        ts.isArrayLiteralExpression(entry.initializer),
        'tracing includes must be literal patterns',
      ).toBe(true);
      if (!ts.isArrayLiteralExpression(entry.initializer)) continue;
      const patterns = entry.initializer.elements.map((element) => {
        expect(ts.isStringLiteral(element), 'each tracing pattern must be a string').toBe(true);
        return ts.isStringLiteral(element) ? element.text.replace(/^\.\//, '') : '';
      });
      includes.push({ route: entry.name.text, patterns });
    }
  }
  ts.forEachChild(node, collectIncludes);
}
collectIncludes(config);

const invoiceRoutes = [
  '/api/musterrechnung',
  '/api/stripe/webhook',
  '/api/rechnungen/vorschau',
  '/rechnungen/[invoiceId]',
  '/einstellungen/rechnungen',
];
const readers = [
  {
    file: 'lib/document-rendering/render.ts',
    routes: [
      ...invoiceRoutes,
      '/api/musterangebot',
      '/api/angebote/vorschau',
      '/angebote/[offerId]',
      '/service/wartung',
    ],
  },
  { file: 'lib/document-rendering/e-invoice.ts', routes: invoiceRoutes },
  { file: 'lib/invoicing/check-en16931.ts', routes: invoiceRoutes },
];

for (const reader of readers) {
  test(`${reader.file} runtime files are traced for every consuming route`, () => {
    const source = ts.createSourceFile(
      reader.file,
      readFileSync(resolve(repositoryRoot, reader.file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const paths = [];
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'readFile'
      ) {
        const path = node.arguments[0];
        expect(path && ts.isCallExpression(path), 'runtime file reads must declare their app-root path').toBe(
          true,
        );
        if (path && ts.isCallExpression(path)) {
          const asset = path.arguments[1];
          expect(
            asset && ts.isStringLiteral(asset),
            'runtime file path must be a literal for tracing coverage',
          ).toBe(true);
          if (asset && ts.isStringLiteral(asset)) paths.push(asset.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(paths.length, 'the check must find the runtime file reads').toBeGreaterThan(0);
    for (const path of paths) {
      expect(existsSync(resolve(repositoryRoot, path)), `${path} must exist`).toBe(true);
      for (const route of reader.routes) {
        const patterns = includes
          .filter((entry) => picomatch(entry.route, { dot: true, contains: true })(route))
          .flatMap((entry) => entry.patterns);
        expect(
          patterns.some((pattern) => new Glob(pattern).match(path)),
          `${route} must trace ${path}`,
        ).toBe(true);
      }
    }
  });
}
