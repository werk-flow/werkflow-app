import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import {
  EQUIPMENT_STATES,
  EQUIPMENT_SUBTYPES_BY_CATEGORY,
  getAllowedEquipmentTransitions,
} from "@/lib/installed-equipment/types";

const root = resolve(import.meta.dir, "../..");
const parsed = new Map<string, ts.SourceFile>();
function sourceAt(file: string): ts.SourceFile {
  const prior = parsed.get(file);
  if (prior) return prior;
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  parsed.set(file, source);
  return source;
}

/** Conservative upper bound: filtering never increases a fixed enum's size. */
function optionBound(
  node: ts.Node,
  seen = new Set<ts.Node>(),
): number | undefined {
  if (seen.has(node)) return undefined;
  const nextSeen = new Set([...seen, node]);
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return optionBound(node.expression, nextSeen);
  if (ts.isArrayLiteralExpression(node)) {
    const counts = node.elements.map((element) =>
      ts.isSpreadElement(element)
        ? optionBound(element.expression, nextSeen)
        : 1,
    );
    return counts.every((count) => count !== undefined)
      ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
      : undefined;
  }
  if (ts.isObjectLiteralExpression(node))
    return node.properties.some(ts.isSpreadAssignment)
      ? undefined
      : node.properties.length;
  if (ts.isConditionalExpression(node)) {
    const branches = [
      optionBound(node.whenTrue, nextSeen),
      optionBound(node.whenFalse, nextSeen),
    ];
    return branches.every((bound) => bound !== undefined)
      ? Math.max(...(branches as number[]))
      : undefined;
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    if (
      ["Object.entries", "Object.keys", "Object.values"].includes(
        node.expression.getText(),
      ) &&
      node.arguments[0]
    )
      return optionBound(node.arguments[0], nextSeen);
    if (["map", "filter"].includes(node.expression.name.text))
      return optionBound(node.expression.expression, nextSeen);
  }
  if (ts.isIdentifier(node)) {
    const source = node.getSourceFile();
    let declaration: ts.VariableDeclaration | undefined;
    function find(current: ts.Node): void {
      if (
        ts.isVariableDeclaration(current) &&
        current.name.getText() === node.getText()
      )
        declaration = current;
      ts.forEachChild(current, find);
    }
    find(source);
    if (declaration?.initializer)
      return optionBound(declaration.initializer, nextSeen);
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const imported = bindings.elements.find(
        (element) => element.name.text === node.text,
      );
      if (!imported) continue;
      const specifier = statement.moduleSpecifier.text;
      const base = specifier.startsWith("@/")
        ? join(root, specifier.slice(2))
        : resolve(dirname(source.fileName), specifier);
      const file = [".ts", ".tsx", "/index.ts", "/index.tsx"]
        .map((extension) => base + extension)
        .find(existsSync);
      if (!file) return undefined;
      const importedSource = sourceAt(file);
      for (const entry of importedSource.statements) {
        if (!ts.isVariableStatement(entry)) continue;
        for (const value of entry.declarationList.declarations)
          if (
            value.name.getText() ===
              (imported.propertyName?.text ?? imported.name.text) &&
            value.initializer
          )
            return optionBound(value.initializer, nextSeen);
      }
    }
  }
  return undefined;
}

// These choices are runtime subsets/configuration. Each is reviewed against
// its finite domain; unknown new expressions fail rather than silently skip.
const runtimeChoices: Record<string, string> = {
  "components/service/equipment-detail-content.tsx:transitionStates":
    "Allowed transitions are bounded by the lifecycle test below.",
  "components/service/equipment-form-dialog.tsx:subtypeOptions":
    "Category chooses one of the fixed equipment subtype enums.",
  "components/shared/metadata-section.tsx:config.options":
    "The primitive uses SearchableSelect above eight; current owners supply fixed customer type, priority and role enums.",
};

test("runtime equipment enum subsets stay under the raw Select limit", () => {
  for (const state of EQUIPMENT_STATES)
    expect(getAllowedEquipmentTransitions(state).length).toBeLessThan(10);
  // Subtype Select includes the additional "Nicht angegeben" option.
  for (const subtypes of Object.values(EQUIPMENT_SUBTYPES_BY_CATEGORY))
    expect(subtypes.length + 1).toBeLessThan(10);
});

test("every raw Select has fewer than ten bounded enum options", () => {
  const failures: string[] = [];
  let selects = 0;
  for (const directory of ["components", "app"])
    for (const relative of readdirSync(join(root, directory), {
      recursive: true,
      encoding: "utf8",
    })) {
      const file = `${directory}/${relative.replaceAll("\\", "/")}`;
      if (!file.endsWith(".tsx") || file.startsWith("components/ui/")) continue;
      const text = readFileSync(join(root, file), "utf8");
      if (!text.includes("SelectContent")) continue;
      const source = sourceAt(join(root, file));
      function visit(node: ts.Node): void {
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText() === "SelectContent"
        ) {
          selects += 1;
          let count = 0;
          function countItems(child: ts.Node): void {
            if (
              ts.isCallExpression(child) &&
              ts.isPropertyAccessExpression(child.expression) &&
              child.expression.name.text === "map"
            ) {
              const collection = child.expression.expression;
              const bound = optionBound(collection);
              if (
                bound === undefined &&
                !runtimeChoices[`${file}:${collection.getText()}`]
              )
                failures.push(`${file}: unresolved ${collection.getText()}`);
              count += bound ?? 0;
              return;
            }
            if (
              (ts.isJsxOpeningElement(child) ||
                ts.isJsxSelfClosingElement(child)) &&
              child.tagName.getText() === "SelectItem"
            )
              count += 1;
            ts.forEachChild(child, countItems);
          }
          countItems(node);
          if (count >= 10) failures.push(`${file}: ${count} possible options`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  expect(selects).toBeGreaterThan(70);
  expect(failures).toEqual([]);
});
