import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

test("the persistent sidebar routes every link through the intent-prefetch owner", () => {
  const path = resolve(import.meta.dir, "../../components/sidebar/app-shell.tsx");
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = source.statements.filter(ts.isImportDeclaration);
  const from = (entry: ts.ImportDeclaration): string => ts.isStringLiteral(entry.moduleSpecifier) ? entry.moduleSpecifier.text : "";
  expect(imports.some((entry) => from(entry) === "next/link")).toBe(false);
  expect(imports.some((entry) => from(entry) === "./sidebar-link")).toBe(true);
});
