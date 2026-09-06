import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  ContextualDocumentRowFrame,
  ContextualDocumentsFrame,
  ContextualDocumentsSkeleton,
} from "@/components/dokumente/contextual-documents-layout";

const root = join(import.meta.dir, "../..");
const description = "Vertragsunterlagen dieser Abdeckung.";

function slotClass(markup: string, slot: string): string {
  const tag = markup.match(new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`))?.[0];
  const className = tag?.match(/class="([^"]*)"/)?.[1];
  if (!className) throw new Error(`Missing rendered slot: ${slot}`);
  return className;
}

function syntaxFor(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(join(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function componentUses(
  syntax: ts.SourceFile,
  owner: string,
  tag: string,
): boolean {
  const component = syntax.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === owner,
  );
  if (!component) throw new Error(`Missing component: ${owner}`);
  function contains(node: ts.Node): boolean {
    return (
      ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(syntax) === tag) ||
      Boolean(ts.forEachChild(node, (child) => contains(child) || undefined))
    );
  }
  return contains(component);
}

test("resolved and loading documents use the same responsive frame and inert row geometry", () => {
  const resolved = renderToStaticMarkup(
    createElement(ContextualDocumentsFrame, {
      title: "Dokumente & Bilder",
      description,
      actions: createElement("button", { type: "button" }, "Hochladen"),
    }, createElement(ContextualDocumentRowFrame, null, "Vertrag.pdf")),
  );
  const loading = renderToStaticMarkup(
    createElement(ContextualDocumentsSkeleton, {
      description,
      canUpload: true,
      canAttach: true,
    }),
  );
  for (const slot of [
    "contextual-documents-frame",
    "contextual-documents-header",
    "contextual-documents-actions",
    "list-row",
  ]) {
    expect(slotClass(loading, slot)).toBe(slotClass(resolved, slot));
  }
  expect(slotClass(loading, "contextual-documents-header")).toContain(
    "flex-col",
  );
  expect(slotClass(loading, "contextual-documents-header")).toContain(
    "sm:flex-row",
  );
  expect(slotClass(loading, "list-row")).not.toContain("hover:");
  expect(loading).toContain("Dokumente &amp; Bilder");
  expect(loading).toContain(description);
  expect(loading).toContain('aria-busy="true"');
  expect(loading).toContain('role="status"');
  expect(loading).not.toMatch(/<(?:button|input|a)(?:\s|>)/);
});

test("loading preserves available toolbar slots and normal/upload emphasis heights", () => {
  const readonly = renderToStaticMarkup(
    createElement(ContextualDocumentsSkeleton, { description }),
  );
  expect(readonly).not.toContain('data-slot="contextual-documents-actions"');
  const normal = renderToStaticMarkup(
    createElement(ContextualDocumentsSkeleton, {
      description,
      canUpload: true,
      canAttach: true,
      emphasizeUpload: false,
    }),
  );
  expect(normal).toContain("h-8 w-28");
  expect(normal).toContain("h-11");
  const emphasized = renderToStaticMarkup(
    createElement(ContextualDocumentsSkeleton, {
      description,
      canUpload: true,
    }),
  );
  expect(emphasized).not.toContain("h-11");
});

test("the real document implementation delegates frame and row layout to the shared owners", () => {
  const syntax = syntaxFor(
    "components/dokumente/contextual-documents-section.tsx",
  );
  expect(
    componentUses(
      syntax,
      "ContextualDocumentsSection",
      "ContextualDocumentsFrame",
    ),
  ).toBe(true);
  expect(
    componentUses(syntax, "DocumentRow", "ContextualDocumentRowFrame"),
  ).toBe(true);
});

test("loaded and loading upload controls consume the same emphasis default", () => {
  for (const [file, owner] of [
    [
      "components/dokumente/contextual-documents-section.tsx",
      "ContextualDocumentsSection",
    ],
    [
      "components/dokumente/contextual-documents-layout.tsx",
      "ContextualDocumentsSkeleton",
    ],
  ]) {
    const syntax = syntaxFor(file);
    const component = syntax.statements.find(
      (node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === owner,
    );
    const parameter = component?.parameters[0]?.name;
    if (!parameter || !ts.isObjectBindingPattern(parameter))
      throw new Error(`Missing component options: ${owner}`);
    const emphasis = parameter.elements.find(
      (binding) => binding.name.getText(syntax) === "emphasizeUpload",
    );
    expect(emphasis?.initializer?.getText(syntax)).toBe(
      "CONTEXTUAL_DOCUMENTS_EMPHASIZE_UPLOAD",
    );
  }
});

test("coverage and both service detail loading states compose the contextual skeleton", () => {
  for (const [file, owner] of [
    [
      "components/service/maintenance-coverage-documents-dialog.tsx",
      "MaintenanceCoverageDocumentsDialog",
    ],
    [
      "components/loading-states/equipment-page-skeleton.tsx",
      "EquipmentDetailSkeleton",
    ],
    [
      "components/loading-states/service-cases-page-skeleton.tsx",
      "ServiceCaseDetailSkeleton",
    ],
  ])
    expect(
      componentUses(syntaxFor(file), owner, "ContextualDocumentsSkeleton"),
    ).toBe(true);
});

test("evidence loading and loaded checkbox lists consume the same container and row classes", () => {
  const syntax = syntaxFor(
    "components/service/maintenance-due-action-dialog.tsx",
  );
  const usages = new Map<string, number>();
  function visit(node: ts.Node): void {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(syntax) === "className" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression;
      if (expression && ts.isIdentifier(expression))
        usages.set(expression.text, (usages.get(expression.text) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  expect(usages.get("EVIDENCE_LIST_CLASS")).toBe(2);
  expect(usages.get("EVIDENCE_ROW_CLASS")).toBe(2);
});
