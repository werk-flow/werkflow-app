import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { listProductSources, parseProductSource, repositoryRoot } from '@/lib/conventions/product-sources';

// Tier 2 guard: no URL carries a person's email address. Request logs, the
// browser history and Referer headers keep every query string, so the address
// travels server-side instead (an httpOnly cookie, the invite row, the
// session). This test fails when product code writes an `email` query
// parameter into a URL, or a page or the proxy reads one back.

const URL_PARAMETER = /[?&]email=/i;
// A receiver that holds a query string: `searchParams`, `URLSearchParams`, `params`, `query`.
const QUERY_RECEIVER = /searchParams|URLSearchParams|params|query/i;
const QUERY_METHODS = new Set(['set', 'append', 'get', 'getAll', 'has']);

function isEmailLiteral(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isStringLiteralLike(node) && node.text === 'email';
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return null;
}

/** `searchParams: Promise<{ email?: string }>` in a page's props, or the same shape on a parameter. */
function declaresEmailSearchParam(node: ts.Node): boolean {
  if (!(ts.isPropertySignature(node) || ts.isParameter(node) || ts.isPropertyDeclaration(node))) return false;
  if (!ts.isIdentifier(node.name) || node.name.text !== 'searchParams' || node.type === undefined)
    return false;
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isPropertySignature(child) && ts.isIdentifier(child.name) && child.name.text === 'email')
      found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node.type);
  return found;
}

function emailUrlFinding(node: ts.Node, source: ts.SourceFile): string | null {
  const text = literalText(node);
  if (text !== null && URL_PARAMETER.test(text)) return 'builds a URL with an email parameter';
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      QUERY_METHODS.has(callee.name.text) &&
      isEmailLiteral(node.arguments[0]) &&
      QUERY_RECEIVER.test(callee.expression.getText(source))
    ) {
      return `calls ${callee.name.text}('email') on a query string`;
    }
    const readsQuery = node.arguments.some((argument) => QUERY_RECEIVER.test(argument.getText(source)));
    if (readsQuery && node.arguments.some(isEmailLiteral)) return 'reads email from a query string';
  }
  if (
    ts.isElementAccessExpression(node) &&
    isEmailLiteral(node.argumentExpression) &&
    QUERY_RECEIVER.test(node.expression.getText(source))
  ) {
    return 'reads email from a query string';
  }
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'URLSearchParams' &&
    (node.arguments ?? []).some((argument) => /\bemail\b/.test(argument.getText(source)))
  ) {
    return 'builds a URLSearchParams with an email entry';
  }
  if (declaresEmailSearchParam(node)) return 'declares an email search parameter';
  return null;
}

function findings(file: string, source: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const finding = emailUrlFinding(node, source);
    if (finding !== null) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push(`${file}:${line + 1} ${finding}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The edge functions' sources, which build the mail links. */
function edgeFunctionSources(): string[] {
  const found: string[] = [];
  const visit = (relative: string): void => {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) found.push(path);
    }
  };
  visit('supabase/functions');
  return found;
}

function plantedFindings(text: string): string[] {
  return findings('app/planted/page.tsx', parseProductSource('app/planted/page.tsx', text));
}

test('no product URL carries an email address, and no page or the proxy reads one from a URL', () => {
  const files = [...listProductSources(), 'proxy.ts', ...edgeFunctionSources()];
  const found = files.flatMap((file) =>
    findings(file, parseProductSource(file, readFileSync(resolve(repositoryRoot, file), 'utf8'))),
  );
  expect(
    found,
    'carry the address server-side: an httpOnly cookie (lib/auth/address-cookies.ts), the invite row or the session',
  ).toEqual([]);
});

describe('planted violations', () => {
  test('a template, a string and URLSearchParams writes are found', () => {
    expect(
      plantedFindings(
        [
          'const a = `/verify?email=${encodeURIComponent(email)}`;',
          "const b = '/signup?invite_code=x&email=' + email;",
          "url.searchParams.set('email', email);",
          "query.append('email', email);",
          'const c = new URLSearchParams({ email });',
        ].join('\n'),
      ),
    ).toEqual([
      'app/planted/page.tsx:1 builds a URL with an email parameter',
      'app/planted/page.tsx:2 builds a URL with an email parameter',
      "app/planted/page.tsx:3 calls set('email') on a query string",
      "app/planted/page.tsx:4 calls append('email') on a query string",
      'app/planted/page.tsx:5 builds a URLSearchParams with an email entry',
    ]);
  });

  test('a proxy read, a page prop and a helper read are found', () => {
    expect(
      plantedFindings(
        [
          "const fromProxy = req.nextUrl.searchParams.get('email');",
          'type Props = { searchParams: Promise<{ email?: string; error?: string }> };',
          "const fromHelper = resolveQueryParam(resolvedSearchParams, 'email');",
          "const fromIndex = resolvedSearchParams['email'];",
        ].join('\n'),
      ),
    ).toEqual([
      "app/planted/page.tsx:1 calls get('email') on a query string",
      'app/planted/page.tsx:2 declares an email search parameter',
      'app/planted/page.tsx:3 reads email from a query string',
      'app/planted/page.tsx:4 reads email from a query string',
    ]);
  });

  test('form fields, columns and lookups named email are not URLs', () => {
    expect(
      plantedFindings(
        [
          "form.setError('email', { message: 'x' });",
          "formData.get('email');",
          "admin.from('profiles').select('id').eq('email', email);",
          "const column = { id: 'email', header: 'E-Mail' };",
          "const mail = 'mailto:' + email;",
        ].join('\n'),
      ),
    ).toEqual([]);
  });
});
