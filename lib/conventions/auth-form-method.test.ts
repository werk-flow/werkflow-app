// Rule test: every form on a sign-in route posts natively.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a submit before JavaScript loads never puts field values in the
// URL" (werk-flow/werkflow-planning#233). Until hydration, a `<form>` submits
// natively, and without `method="post"` the browser sends a GET: the email and
// password land in the URL, browser history and request logs. Every `<form>`
// element under app/(auth)/ therefore sets `method="post"` as a string literal.

const AUTH_ROUTES = 'app/(auth)/';

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
  test('every <form> under app/(auth)/ sets method="post"', () => {
    const authSources = listProductSources(['app']).filter((file) => file.startsWith(AUTH_ROUTES));
    expect(authSources.flatMap((file) => formsWithoutPost(file))).toEqual([]);
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
