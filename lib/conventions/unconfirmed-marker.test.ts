import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for "content that is not confirmed is never presented as confirmed"
// (realtime-and-caching.md, "Checklist"). The registry primitives carry the
// unconfirmed marker of lib/ui/unconfirmed.ts: `ListRow`, `TableRow` and
// `Card` from their `unconfirmed` prop, `PendingRow` always, and an active
// `InlinePending` on itself, so a record that contains it reads as
// unconfirmed. A surface owns the marker when it renders an optimistic layer:
//
//   1. A component file that reads an optimistic flag (`isOptimistic`, a
//      `pendingIds` set, a non-null `tempId`) renders one of the marker
//      primitives, sets `unconfirmed` or `unconfirmedMarker(...)`, or passes
//      the flag on in a JSX attribute to a component that does.
//   2. A hand-built pending row (`data-pending-row`) carries the marker on the
//      same element.

const OPTIMISTIC_FLAG = /\bisOptimistic\b|\bpendingIds\b|\btempId\s*!==\s*null\b/;
const MARKER_PRIMITIVES = new Set(['InlinePending', 'PendingRow', 'SettlingIndicator']);
/** Props through which a surface hands the flag to the component that renders the record. */
const FORWARDING_PROPS = /^(isOptimistic|isPending|isPendingRow|isBusy|isSettling|pending|rowFeedback|rows)$/;

type Finding = { file: string; line: number; problem: string };

function attributeName(attribute: ts.JsxAttributeLike): string | null {
  return ts.isJsxAttribute(attribute) ? attribute.name.getText() : null;
}

function marksItself(element: ts.JsxOpeningLikeElement): boolean {
  return element.attributes.properties.some(
    (attribute) =>
      attributeName(attribute) === 'unconfirmed' ||
      (ts.isJsxSpreadAttribute(attribute) && /\bunconfirmedMarker\(/.test(attribute.expression.getText())),
  );
}

/** Findings of one source; exported for the planted probes below. */
export function unconfirmedMarkerFindings(file: string, text: string): Finding[] {
  if (!file.endsWith('.tsx')) return [];
  const source = parseProductSource(file, text);
  const findings: Finding[] = [];
  let readsFlag = false;
  let rendersMarker = false;
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  function visit(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (MARKER_PRIMITIVES.has(tag) || marksItself(node)) rendersMarker = true;
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          /^[A-Z]/.test(tag) &&
          FORWARDING_PROPS.test(attribute.name.getText())
        )
          rendersMarker = true;
      }
      const pendingRow = node.attributes.properties.some(
        (attribute) => attributeName(attribute) === 'data-pending-row',
      );
      if (pendingRow && !marksItself(node))
        findings.push({
          file,
          line: lineOf(node),
          problem: 'a pending row without the unconfirmed marker on the same element',
        });
    }
    if (
      (ts.isIdentifier(node) || ts.isBinaryExpression(node)) &&
      !ts.isJsxAttribute(node.parent) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !ts.isPropertySignature(node.parent) &&
      OPTIMISTIC_FLAG.test(node.getText())
    )
      readsFlag = true;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (readsFlag && !rendersMarker)
    findings.push({
      file,
      line: 1,
      problem:
        'reads an optimistic flag but renders no unconfirmed marker and passes the flag to no component',
    });
  return findings;
}

describe('unconfirmed marker', () => {
  test('every surface that renders an optimistic layer carries the marker', () => {
    const findings = listProductSources(['app', 'components']).flatMap((file) =>
      unconfirmedMarkerFindings(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
    );
    expect(findings).toEqual([]);
  });

  test('planted probes: an unmarked optimistic row and a hand-built pending row are found', () => {
    const unmarked = `export function Rows({ rows }) {
  return rows.map(({ item, isOptimistic }) => <ListRow key={item.id} className={isOptimistic ? 'opacity-70' : ''}>{item.name}</ListRow>);
}`;
    expect(unconfirmedMarkerFindings('probe.tsx', unmarked).map((finding) => finding.problem)).toEqual([
      'reads an optimistic flag but renders no unconfirmed marker and passes the flag to no component',
    ]);
    const marked = unmarked.replace(
      '<ListRow key={item.id}',
      '<ListRow key={item.id} unconfirmed={isOptimistic}',
    );
    expect(unconfirmedMarkerFindings('probe.tsx', marked)).toEqual([]);
    const handBuilt = `export const Draft = () => <div role="status" data-pending-row="">Neu</div>;`;
    expect(unconfirmedMarkerFindings('probe.tsx', handBuilt)).toHaveLength(1);
    expect(
      unconfirmedMarkerFindings(
        'probe.tsx',
        handBuilt.replace('<div ', '<div {...unconfirmedMarker(true)} '),
      ),
    ).toEqual([]);
  });
});
