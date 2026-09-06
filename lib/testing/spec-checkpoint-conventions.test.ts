import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

function isDescribeCall(expression: ts.Expression): boolean {
  const path: string[] = [];
  let current = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) path.unshift(current.name.text);
    else if (ts.isStringLiteral(current.argumentExpression)) path.unshift(current.argumentExpression.text);
    else return false;
    current = current.expression;
  }
  return ts.isIdentifier(current) && current.text === 'test' && path[0] === 'describe' &&
    path.slice(1).every((modifier) => ['serial', 'parallel', 'only', 'skip', 'fixme'].includes(modifier));
}

function unownedScenarioVariables(syntax: ts.SourceFile): string[] {
  const unowned: string[] = [];
  function inspect(statements: ts.NodeArray<ts.Statement>): void {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement) && !(statement.declarationList.flags & ts.NodeFlags.Const)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = declaration.name.getText(syntax);
          // A cached stateless service client does not carry a scenario fact.
          if (name !== "readOnlyAdminClient") unowned.push(name);
        }
      }
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
      const call = statement.expression;
      if (!isDescribeCall(call.expression)) continue;
      for (const argument of call.arguments) {
        if ((ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && ts.isBlock(argument.body)) inspect(argument.body.statements);
      }
    }
  }
  inspect(syntax.statements);
  return unowned;
}

for (const variant of ['test.describe', 'test.describe.serial', 'test.describe.parallel', 'test.describe.only', 'test.describe.skip', 'test.describe.fixme', 'test.describe.serial.only', 'test . describe . serial', 'test["describe"]["serial"]']) {
  for (const callback of ['() =>', 'function namedGroup()']) {
    test(`describe callback ownership detects ${variant} with ${callback}`, () => {
      const source = `${variant}('group', ${callback} { let sharedId = ''; test('consumer', async () => { let localAttempt = 0; }); });`;
      const syntax = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
      expect(unownedScenarioVariables(syntax)).toEqual(['sharedId']);
    });
  }
}

test('describe callback ownership follows nested groups but permits locals inside test bodies', () => {
  const source = `
    let moduleId = '';
    let readOnlyAdminClient;
    test.describe.serial('outer', function () {
      test.describe('inner', () => { let nestedId = ''; });
      test('case', function () { let localValue = ''; });
      function helper() { let helperLocal = ''; }
    });
  `;
  const syntax = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  expect(unownedScenarioVariables(syntax)).toEqual(['moduleId', 'nestedId']);
});

const root = join(import.meta.dir, "..", "..");
const files = ["tests/audit", "tests/golden"].flatMap((directory) =>
  readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => join(directory, name)),
);

for (const file of files) {
  const source = readFileSync(join(root, file), "utf8");
  const syntax = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  test(`${file} keeps persisted test facts outside module memory`, () => {
    expect(unownedScenarioVariables(syntax)).toEqual([]);
  });

  if (file.replaceAll("\\", "/").startsWith("tests/audit/")) {
    test(`${file} uses the audit world owner`, () => {
      const imports = syntax.statements
        .filter(ts.isImportDeclaration)
        .map((statement) =>
          ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : "",
        );
      expect(
        imports.some((path) => /(?:\.\/|\.\.\/)support\/fixtures$/.test(path)),
      ).toBe(true);
      expect(
        imports.some((path) => path.includes("golden/support/fixtures")),
      ).toBe(false);
    });
  }
}
