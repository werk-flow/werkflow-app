import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const ROOT = join(import.meta.dir, "../..");
const productFiles = ["app", "components"]
  .flatMap((directory) =>
    readdirSync(join(ROOT, directory), { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".tsx"))
      .map((name) => `${directory}/${name.replaceAll("\\", "/")}`),
  )
  .filter((name) => !name.startsWith("components/ui/"));
const sources = new Map(
  productFiles.map((file) => [file, readFileSync(join(ROOT, file), "utf8")]),
);

const PAIRS = [
  ["components/anfragen/anfragen-content.tsx"],
  ["components/auftraege/unified-auftraege-table.tsx"],
  [
    "components/dokumente/document-library-table.tsx",
    "components/dokumente/document-library-content.tsx",
  ],
  ["components/dokumente/document-work-context-view.tsx"],
  [
    "components/inventar/inventory-content.tsx",
    "components/loading-states/inventar-page-skeleton.tsx",
  ],
  ["components/kunden/clients-table.tsx"],
  ["components/mitarbeiter/members-table.tsx"],
  [
    "components/service/equipment-list-content.tsx",
    "components/loading-states/equipment-page-skeleton.tsx",
  ],
  [
    "components/service/service-case-list-content.tsx",
    "components/loading-states/service-cases-page-skeleton.tsx",
  ],
  ["components/service/maintenance-content.tsx"],
  ["components/zeiterfassung/entry-history.tsx"],
  ["components/zeiterfassung/time-period-results.tsx"],
] as const;

// This tab renders the page's personnel payload synchronously. The route's
// initial member tab owns its skeleton; personnel rows still require cards.
const SYNCHRONOUS_TABLES = [
  "components/mitarbeiter/personnel-records-section.tsx",
  // Renders from the members page payload; its unused skeleton was removed on 2026-09-14.
  "components/mitarbeiter/invitations-table.tsx",
];

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;
function attribute(node: Opening, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (item): item is ts.JsxAttribute =>
      ts.isJsxAttribute(item) && item.name.getText() === name,
  );
}
function isOpening(node: ts.Node): node is Opening {
  return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);
}
function interaction(node: Opening): string {
  const prop = attribute(node, "interactive");
  if (!prop) return "false";
  if (!prop.initializer) return "true";
  const value = prop.initializer;
  const expression = ts.isJsxExpression(value) ? value.expression : value;
  if (!expression) return "false";
  if (ts.isStringLiteral(expression)) return expression.text;
  const source = expression.getText();
  // A committed row is interactive; a temporary optimistic ID cannot open.
  if (source === "!isPending") return "true";
  if (source === "true" || source === "false") return source;
  throw new Error(`Unproven row interaction expression: ${source}`);
}

function rowInteractions(
  source: string,
): Array<{ kind: string; skeleton: boolean; value: string }> {
  const syntax = ts.createSourceFile(
    "contract.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const rows: Array<{ kind: string; skeleton: boolean; value: string }> = [];
  function visit(node: ts.Node): void {
    if (isOpening(node)) {
      const name = node.tagName.getText();
      if (
        [
          "TableRow",
          "ListRow",
          "SkeletonRows",
          "SkeletonTable",
          "SkeletonList",
        ].includes(name)
      ) {
        const skeleton =
          name.startsWith("Skeleton") || Boolean(attribute(node, "skeleton"));
        const optimistic =
          Boolean(attribute(node, "data-pending-row")) ||
          attribute(node, "role")?.initializer?.getText() === '"status"';
        // Header/empty rows are not records. Data TableRow owners have a key
        // or click handler, even when their per-row action buttons are quiet.
        if (
          !optimistic &&
          (name !== "TableRow" ||
            skeleton ||
            attribute(node, "key") ||
            attribute(node, "onClick"))
        ) {
          rows.push({
            kind: ["ListRow", "SkeletonList"].includes(name) ? "card" : "table",
            skeleton,
            value: interaction(node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return rows;
}

function desktopOnly(node: ts.Node): boolean {
  for (
    let current: ts.Node | undefined = node;
    current;
    current = current.parent
  ) {
    const opening = ts.isJsxElement(current)
      ? current.openingElement
      : isOpening(current)
        ? current
        : undefined;
    if (!opening) continue;
    const classes =
      attribute(opening, "className")?.initializer?.getText() ?? "";
    if (
      /\bhidden\b/.test(classes) &&
      /\bmd:(block|table|flex|grid)\b/.test(classes)
    )
      return true;
  }
  return false;
}

describe("row interaction and mobile-table contracts", () => {
  test("clickable mobile navigation exposes a link to the same destination", () => {
    const violations: string[] = [];
    for (const [file, source] of sources) {
      if (!source.includes("router.push") || !source.includes("ListRow"))
        continue;
      const syntax = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node): void {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText() === "ListRow"
        ) {
          const click = attribute(node.openingElement, "onClick");
          const destinations: string[] = [];
          function findDestination(child: ts.Node): void {
            if (
              ts.isCallExpression(child) &&
              child.expression.getText() === "router.push" &&
              child.arguments[0]
            )
              destinations.push(child.arguments[0].getText());
            ts.forEachChild(child, findDestination);
          }
          if (click) findDestination(click);
          const links: string[] = [];
          function findLink(child: ts.Node): void {
            if (
              isOpening(child) &&
              ["Link", "a"].includes(child.tagName.getText())
            ) {
              const href = attribute(child, "href")?.initializer;
              if (href)
                links.push(
                  ts.isJsxExpression(href)
                    ? (href.expression?.getText() ?? "")
                    : href.getText(),
                );
            }
            ts.forEachChild(child, findLink);
          }
          findLink(node);
          for (const destination of destinations)
            if (!links.includes(destination))
              violations.push(`${file}: ${destination}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(syntax);
    }
    expect(violations).toEqual([]);
  });

  test("detects a skeleton losing hover independently of its live row", () => {
    const rows = rowInteractions(
      "<><ListRow interactive onClick={open} /><SkeletonList /></>",
    );
    expect(rows).toEqual([
      { kind: "card", skeleton: false, value: "true" },
      { kind: "card", skeleton: true, value: "false" },
    ]);
    expect(rows[0]?.value).not.toBe(rows[1]?.value);
  });

  for (const pair of PAIRS) {
    test(`${pair[0]} matches live and skeleton interaction`, () => {
      const rows = pair.flatMap((file) =>
        rowInteractions(sources.get(file) ?? ""),
      );
      const skeletonRows = rows.filter((row) => row.skeleton);
      expect(skeletonRows.length).toBeGreaterThan(0);
      for (const skeleton of skeletonRows) {
        const liveValues = [
          ...new Set(
            rows
              .filter((row) => !row.skeleton && row.kind === skeleton.kind)
              .map((row) => row.value),
          ),
        ];
        expect(liveValues, `${pair[0]} ${skeleton.kind}`).toEqual([
          skeleton.value,
        ]);
      }
    });
  }

  test("every product Table is accounted for, including unannotated new tables", () => {
    const accounted = new Set<string>([...PAIRS.flat(), ...SYNCHRONOUS_TABLES]);
    const unaccounted: string[] = [];
    const mobileTables: string[] = [];
    for (const [file, source] of sources) {
      const syntax = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const tableNames = new Set(["Table", "table", "SkeletonTable"]);
      for (const statement of syntax.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        )
          continue;
        if (
          !/\/ui\/(table|skeleton-table)$/.test(statement.moduleSpecifier.text)
        )
          continue;
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings))
          for (const binding of bindings.elements) {
            if (
              ["Table", "SkeletonTable"].includes(
                binding.propertyName?.text ?? binding.name.text,
              )
            )
              tableNames.add(binding.name.text);
          }
      }
      function visit(node: ts.Node): void {
        if (isOpening(node) && tableNames.has(node.tagName.getText())) {
          if (!accounted.has(file)) unaccounted.push(file);
          if (!desktopOnly(node)) mobileTables.push(file);
        }
        ts.forEachChild(node, visit);
      }
      visit(syntax);
    }
    expect([...new Set(unaccounted)]).toEqual([]);
    expect([...new Set(mobileTables)]).toEqual([]);
  });
});
