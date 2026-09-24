import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// Tier 2 for the one-home rule (AGENTS.md "Language And Coding Standards";
// Step 3 CL-05 found formatFileSize copied into seven files, three date
// formatters and four duration formatters under different names, and six
// inline search normalizers). A module-level helper name declared in two or
// more product files is a copy until proven otherwise. The names below are
// the copies that existed when the check landed (2026-09-14) with their copy
// count; a count may only fall, and a name leaves the list with its last copy.
// A new shared name, or a known one with a new copy, fails here with the files.

const repositoryRoot = resolve(import.meta.dir, "../..");
const productRoots = ["app", "components", "hooks", "lib"];

const KNOWN_DUPLICATE_HELPERS: Readonly<Record<string, number>> = {
  ActiveWorkIndicator: 2,
  announceSubmission: 3,
  applyDropdownFilters: 2,
  calculateTotalMinutes: 2,
  canonicalize: 4,
  copyStorageObject: 2,
  decimalFromInput: 2,
  defaultCalendarWindow: 2,
  EmptyState: 2,
  errorMessage: 4,
  escapeHtml: 2,
  EvidenceDialog: 2,
  Fact: 2,
  formatAddress: 2,
  formatDate: 20,
  formatDateTime: 12,
  formatDuration: 2,
  formatMinutes: 2,
  formatRange: 3,
  formatSicknessRange: 2,
  formatSiteAddress: 2,
  formatTime: 3,
  fromIsoDate: 2,
  getActiveJobIdsForOrg: 2,
  getCalendarWindow: 2,
  getCurrentClockState: 2,
  getErrorMessage: 2,
  getFileIcon: 2,
  getFileTypeLabel: 2,
  getLinkBadges: 2,
  getSortValue: 2,
  getUploaderName: 2,
  isoToLocalDate: 4,
  isValidIsoDate: 3,
  loadClientOptions: 2,
  mapRpcError: 2,
  maskEmail: 2,
  missingFields: 3,
  mutationError: 2,
  normalizeDatabaseError: 2,
  normalizeOptionalText: 2,
  nullableText: 3,
  optionalText: 2,
  readRequiredEnv: 2,
  ReasonDialog: 3,
  requireManagerAndClient: 2,
  resolveActionContext: 3,
  shiftIsoDateByDays: 2,
  SortableHeader: 2,
  sortTimeEntries: 2,
  todayBerlin: 2,
  toIsoDate: 2,
  toJson: 3,
  toLocalDate: 3,
  TrafficLight: 2,
};

function listProductSources(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== "lib/testing") visit(path);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\/route\.ts$/.test(path) && path !== "lib/supabase/database.types.ts") {
        found.push(path);
      }
    }
  }
  for (const root of productRoots) visit(root);
  return found.sort();
}

/** Module-level function declarations and arrow or function expressions bound to a const. */
function moduleHelperNames(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(resolve(repositoryRoot, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) names.push(statement.name.text);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (ts.isIdentifier(declaration.name) && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        names.push(declaration.name.text);
      }
    }
  }
  return names;
}

test("a module-level helper name is declared in one product file unless it is a known copy", () => {
  const filesByName = new Map<string, string[]>();
  for (const file of listProductSources()) {
    for (const name of new Set(moduleHelperNames(file))) filesByName.set(name, [...(filesByName.get(name) ?? []), file]);
  }
  const duplicated = new Map([...filesByName].filter(([, files]) => files.length > 1));
  const grown = [...duplicated].filter(([name, files]) => files.length > (KNOWN_DUPLICATE_HELPERS[name] ?? 1));
  expect(
    grown.map(([name, files]) => `${name}: ${files.join(", ")}`),
    "One home per helper: move the shared implementation into the owning lib module and import it (AGENTS.md coding standards; Step 3 CL-05). Same-name helpers with genuinely different meaning need different names.",
  ).toEqual([]);
  const shrunk = Object.entries(KNOWN_DUPLICATE_HELPERS).filter(([name, count]) => (duplicated.get(name)?.length ?? 1) < count);
  expect(shrunk.map(([name]) => name), "These names have fewer copies than KNOWN_DUPLICATE_HELPERS records; lower the count or remove the name so the list only shrinks.").toEqual([]);
}, 60_000);
