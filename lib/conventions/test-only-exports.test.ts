import { describe, expect, test } from 'bun:test';

import ts from 'typescript';
import { separatelyExportedNames } from './duplicate-detection';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "nothing is left unused" in production. `bun run unused:check`
// ends with `knip --production` (knip.ts), where a unit test is no consumer:
// an export that only a unit test imports is dead there, unless its JSDoc
// carries `@internal`, which knip skips in production mode. Each such seam is
// listed here: a test seam, or an export whose only consumer is a config file
// that knip does not read in production (next.config.ts). The list may only
// shrink, an entry whose tag is gone fails, and the reason lives in the
// seam's JSDoc beside the tag.

const KNOWN_TEST_SEAMS: readonly string[] = [
  'lib/calendar/messages.ts#CALENDAR_REFUSAL_CODES',
  'lib/installed-equipment/validation.ts#equipmentFormSchema',
  'lib/jobs/option-server.ts#loadJobEntityOptions',
  'lib/personnel/targets.ts#resolveHolidayRegionOnDate',
  'lib/qualifications/resolution.ts#resolveApprenticeWarning',
  'lib/qualifications/resolution.ts#resolveRequirementCoverage',
  'lib/security/csp-report.ts#buildContentSecurityPolicy',
  'lib/security/csp-report.ts#buildReportOnlyContentSecurityPolicy',
  'lib/storage/r2.ts#assertOrganizationStorageKey',
  'lib/supabase/query-batches.ts#BATCH_CONCURRENCY',
  'lib/supabase/query-batches.ts#ID_BATCH_SIZE',
  'lib/supabase/query-batches.ts#ROW_PAGE_SIZE',
  'lib/time-accounts/calculation.ts#roundSecondsToMinutes',
  'lib/time-tracking/closed-period-dates.ts#entryBusinessDate',
  'lib/time-tracking/segments.ts#getSegmentDurationMinutes',
  'lib/time-tracking/validation-messages.ts#TIME_VALIDATION_CODES',
  'lib/vacation/balance.ts#listIsoDatesInRange',
  'lib/work-lifecycle/types.ts#WORK_TRANSITIONS',
];

type TestSeam = { key: string; documented: boolean };

function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
    );
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)) &&
    statement.name
  )
    return [statement.name.text];
  return [];
}

/** Exported module-level declarations whose JSDoc carries `@internal`, as `file#name`. */
function findTestSeams(file: string, text?: string): TestSeam[] {
  const source = parseProductSource(file, text);
  const exportedLater = separatelyExportedNames(source);
  return source.statements.flatMap((statement) => {
    const exported =
      (ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement) ?? []).some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )) ||
      declaredNames(statement).some((name) => exportedLater.has(name));
    if (!exported) return [];
    const docs = ts.getJSDocCommentsAndTags(statement).filter(ts.isJSDoc);
    const tagged = docs.some((doc) => (doc.tags ?? []).some((tag) => tag.tagName.text === 'internal'));
    if (!tagged) return [];
    const documented = docs.some((doc) => (ts.getTextOfJSDocComment(doc.comment) ?? '').trim().length > 0);
    return declaredNames(statement).map((name) => ({ key: `${file}#${name}`, documented }));
  });
}

describe('test-only exports', () => {
  const seams = listProductSources().flatMap((file) => findTestSeams(file));

  test('every @internal export is a known test seam, and every known seam keeps its tag', () => {
    expect(seams.map((seam) => seam.key).sort()).toEqual([...KNOWN_TEST_SEAMS].sort());
  });

  test('every @internal export says in its JSDoc why a test needs it', () => {
    expect(seams.filter((seam) => !seam.documented).map((seam) => seam.key)).toEqual([]);
  });

  test('the scan finds a tagged export with or without a reason and skips the rest (probe)', () => {
    const tagged = '/**\n * The unit test reads the list.\n * @internal\n */\nexport const CODES = [1];\n';
    const bare = '/** @internal */\nexport function seam(): void {}\n';
    const untagged = '/** The list. */\nexport const CODES = [1];\n/** @internal */\nconst LOCAL = 2;\n';
    expect(findTestSeams('lib/probe.ts', tagged)).toEqual([{ key: 'lib/probe.ts#CODES', documented: true }]);
    expect(findTestSeams('lib/probe.ts', bare)).toEqual([{ key: 'lib/probe.ts#seam', documented: false }]);
    expect(findTestSeams('lib/probe.ts', untagged)).toEqual([]);
    const separate = '/** @internal */\nconst LATER = 3;\nexport { LATER };\n';
    expect(findTestSeams('lib/probe.ts', separate)).toEqual([
      { key: 'lib/probe.ts#LATER', documented: false },
    ]);
  });
});
