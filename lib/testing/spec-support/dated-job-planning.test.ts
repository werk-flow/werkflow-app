// Rule test: a browser step that creates a dated job with a person answers its planning warning.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

// A job saved with a date and a person runs the calendar's capacity check on
// its visit (werk-flow/werkflow-planning#266). The audit world has no work
// schedules, so a weekend date, or a second job for the same person that day,
// asks for a planning reason, and the create from the Aufträge list keeps its
// pending row until the reason comes. createJob in
// tests/golden/support/steps/work.ts answers it through `planningOverride`
// and throws at run time without it. This check fails the same call before
// any browser group runs: every literal createJob call that sets
// `plannedDateDigits` and `assignEmployeeName` passes `planningOverride`.
// Options built elsewhere stay with the run-time guard.

const ROOT = join(import.meta.dir, '../../..');
const REQUIRED_TOGETHER = ['plannedDateDigits', 'assignEmployeeName'];

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
  if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
    return property.name.text;
  }
  return null;
}

/** The `file:line` of each literal createJob call with a date and a person but no planning override. */
function datedJobsWithoutPlanningOverride(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const offenders: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createJob'
    ) {
      const options = node.arguments[1];
      if (options && ts.isObjectLiteralExpression(options)) {
        const names = new Set(options.properties.map(propertyName));
        if (REQUIRED_TOGETHER.every((name) => names.has(name)) && !names.has('planningOverride')) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          offenders.push(`${fileName}:${line + 1}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return offenders;
}

function testSourceFiles(): string[] {
  return readdirSync(join(ROOT, 'tests'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.includes('node_modules'))
    .map((file) => `tests/${file}`);
}

describe('a dated job with a person answers its planning warning in browser steps', () => {
  test('every literal createJob call with a date and a person passes planningOverride', () => {
    const offenders = testSourceFiles().flatMap((file) =>
      datedJobsWithoutPlanningOverride(file, readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  test('the check finds a call without the override and passes one with it', () => {
    const missing = `await createJob(page, { jobNumber, title, plannedDateDigits: '01012030', assignEmployeeName: 'Emil' });`;
    const answered = `await createJob(page, { jobNumber, title, plannedDateDigits: '01012030', assignEmployeeName: 'Emil', planningOverride: { orgId, reason } });`;
    const undated = `await createJob(page, { jobNumber, title, assignEmployeeName: 'Emil' });`;
    expect(datedJobsWithoutPlanningOverride('probe.ts', missing)).toEqual(['probe.ts:1']);
    expect(datedJobsWithoutPlanningOverride('probe.ts', answered)).toEqual([]);
    expect(datedJobsWithoutPlanningOverride('probe.ts', undated)).toEqual([]);
  });
});
