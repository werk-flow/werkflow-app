// Rule test: every form on a sign-in route posts natively.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a submit before JavaScript loads never puts field values in the
// URL" (werk-flow/werkflow-planning#233). Until hydration, a `<form>` submits
// natively, and without `method="post"` the browser sends a GET: the email and
// password land in the URL, browser history and request logs. Every `<form>`
// element under app/(auth)/, and in each component a file there imports
// directly (the new-password and code forms), therefore sets `method="post"`
// as a string literal.

const AUTH_ROUTES = 'app/(auth)/';

/** The auth route files and the product components they import directly. */
function authFormSources(): string[] {
  const products = new Set(listProductSources());
  const routes = [...products].filter((file) => file.startsWith(AUTH_ROUTES));
  const imported = routes.flatMap((file) =>
    parseProductSource(file).statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('@/')) return [];
      const base = specifier.slice(2);
      return [`${base}.tsx`, `${base}/index.tsx`].filter((candidate) => products.has(candidate));
    }),
  );
  return [...new Set([...routes, ...imported])];
}

/** Each `<form>` in the source without a literal `method="post"`, as `file:line`. */
function formsWithoutPost(fileName: string, text?: string): string[] {
  const source = parseProductSource(fileName, text);
  const findings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'form' &&
      !postsNatively(node.attributes)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      findings.push(`${fileName}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function postsNatively(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some(
    (attribute) =>
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === 'method' &&
      attribute.initializer !== undefined &&
      ts.isStringLiteral(attribute.initializer) &&
      attribute.initializer.text === 'post',
  );
}

describe('auth form method', () => {
  test('every <form> a sign-in route renders sets method="post"', () => {
    const sources = authFormSources();
    expect(sources).toContain('components/otp-form.tsx');
    expect(sources).toContain('components/password/new-password-fields-form.tsx');
    expect(sources.flatMap((file) => formsWithoutPost(file))).toEqual([]);
  });

  test('probes: a form without a literal post is reported, a posting form is not', () => {
    const component = (form: string) => `export function Probe() { return ${form}; }`;
    for (const form of [
      '<form onSubmit={submit}><input name="email" /></form>',
      '<form method="get" onSubmit={submit} />',
      '<form method={method} onSubmit={submit} />',
      '<form {...props} />',
      '<div><form className="grid" noValidate /></div>',
    ]) {
      expect(formsWithoutPost('app/(auth)/probe.tsx', component(form)), form).toHaveLength(1);
    }
    for (const form of [
      '<form className="grid" method="post" onSubmit={submit}><input name="email" /></form>',
      '<form method="post" />',
      '<Form {...form}><div /></Form>',
    ]) {
      expect(formsWithoutPost('app/(auth)/probe.tsx', component(form)), form).toEqual([]);
    }
  });
});
