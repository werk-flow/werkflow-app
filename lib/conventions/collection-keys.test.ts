import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// Tier 2 for Step 3 CL-13 and CL-D8: a React `key` built from a mapped or
// joined collection remounts the element whenever any row changes, so a route
// refresh after a booking closed the dialog a field worker had just opened.
// Freshness comes from props or a live view; a reset needs a stable resetKey.

const repositoryRoot = resolve(import.meta.dir, "../..");

// Keyed on purpose: the move/copy dialog's selection is a snapshot taken when
// it opens, not a live row set, so the key changes only with a new selection.
// The exception names the one key expression; every other key in the file counts.
const KEYED_SELECTIONS: ReadonlyArray<{ file: string; keyContains: string }> = [
  { file: "components/dokumente/document-library-content.tsx", keyContains: "moveCopyDialog.documents.map(" },
];

function listComponentSources(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) found.push(path);
    }
  }
  visit("app");
  visit("components");
  return found.sort();
}

function collectionKeyLines(file: string): number[] {
  const source = ts.createSourceFile(file, readFileSync(resolve(repositoryRoot, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const allowed = KEYED_SELECTIONS.filter((selection) => selection.file === file).map((selection) => selection.keyContains);
  const lines: number[] = [];
  function callsCollectionMethod(node: ts.Node): boolean {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["map", "join"].includes(node.expression.name.text)) return true;
    return ts.forEachChild(node, callsCollectionMethod) ?? false;
  }
  function visit(node: ts.Node): void {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === "key" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && callsCollectionMethod(node.initializer.expression)) {
      const expression = node.initializer.expression.getText(source);
      if (!allowed.some((fragment) => expression.includes(fragment))) lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return lines;
}

test("no React key is built from a mapped or joined collection", () => {
  const findings = listComponentSources()
    .flatMap((file) => collectionKeyLines(file).map((line) => `${file}:${line}`));
  expect(
    findings,
    "A key derived from a collection remounts the element on every row change and closes open dialogs (Step 3 CL-13). Pass fresh rows as props or read them through a live view; use a stable resetKey for a deliberate reset.",
  ).toEqual([]);
}, 60_000);
