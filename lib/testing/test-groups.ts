import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import ts from "typescript";
import { scenariosForFiles } from "./measured-scenarios";

export interface TestGroup {
  readonly id: string;
  readonly kind: "golden" | "audit" | "ui" | "unit" | "sql" | "canary" | "static";
  readonly files: readonly string[];
  readonly scopes: readonly string[];
  readonly prerequisites: readonly string[];
  readonly isolation: "group-world" | "integrated-world" | "process" | "database-transaction" | "cloud-world";
  readonly timing: GroupTimingRequirements;
  /** Package script a static group runs; declared here so the registry is its only home. */
  readonly script?: string;
}

export interface GroupTimingRequirements {
  readonly requireFreshness: boolean;
  readonly requireReadiness: boolean;
  readonly exclusive: boolean;
  /** Registered measured-scenario ids the group must record (Step 2). */
  readonly requiredScenarios?: readonly string[];
}

const untimed: GroupTimingRequirements = { requireFreshness: false, requireReadiness: false, exclusive: false };
const freshnessFiles = new Set([
  "tests/golden/gg-00.spec.ts", "tests/golden/p1-10.spec.ts", "tests/golden/p1-11.spec.ts", "tests/golden/p1-12.spec.ts",
  "tests/golden/p1-18.spec.ts", "tests/golden/p1-19.spec.ts", "tests/golden/p1-24.spec.ts",
  "tests/canary/canary.spec.ts",
  "tests/audit/performance/calendar-live.spec.ts",
  "tests/audit/performance/planning-benchmark.spec.ts",
]);
// Audit P1-22 measures opening readiness inside its imported submission helper.
// This ownership declaration must survive a helper refactor or removal of a timing call.
const readinessSources: Readonly<Record<string, string>> = {
  "tests/golden/p1-22.spec.ts": "tests/golden/p1-22.spec.ts",
  "tests/golden/p1-11.spec.ts": "tests/golden/p1-11.spec.ts",
  "tests/audit/wave-2/p1-22.spec.ts": "tests/audit/support/time-corrections.ts",
  "tests/audit/performance/calendar-live.spec.ts": "tests/audit/support/time-corrections.ts",
};

function declaredTiming(files: readonly string[]): GroupTimingRequirements {
  const requireFreshness = files.some((file) => freshnessFiles.has(file));
  const requireReadiness = files.some((file) => readinessSources[file] !== undefined);
  const requiredScenarios = scenariosForFiles(files).map((scenario) => scenario.id);
  return { requireFreshness, requireReadiness, requiredScenarios, exclusive: requireFreshness || requireReadiness || requiredScenarios.length > 0 };
}

// Prefixes describe ownership, not proof that a change cannot affect another area.
// Selection follows actual imports and treats unmatched runtime files as global.
// Every prefix must exist on disk (test-scope-prefixes.test.ts): a prefix that names
// no directory owns nothing, and its code silently becomes global (the customer
// library was listed as lib/customers/ while it lives in lib/clients/, 2026-09-14).
export const TEST_SCOPE_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  customers: ["lib/clients/", "lib/customer-relationships/", "lib/requests/", "components/kunden/", "components/anfragen/", "app/(app)/kunden/", "app/(app)/anfragen/"],
  work: ["lib/jobs/", "lib/projects/", "lib/work-lifecycle/", "lib/work-templates/", "lib/work-artifacts/", "lib/work-handover/", "components/auftraege/", "components/arbeitsvorlagen/", "app/(app)/auftraege/", "app/(app)/arbeitsvorlagen/"],
  planning: ["lib/calendar/", "lib/planning/", "lib/dispatch/", "lib/commitments/", "components/kalender/", "app/(app)/kalender/"],
  personnel: ["lib/personnel/", "lib/responsibilities/", "lib/qualifications/", "lib/sickness/", "lib/vacation/", "components/mitarbeiter/", "app/(app)/mitarbeiter/", "app/(app)/qualifikationen/"],
  time: ["lib/time-tracking/", "lib/time-corrections/", "lib/time-accounts/", "components/zeiterfassung/", "app/(app)/zeiterfassung/"],
  documents: ["lib/documents/", "components/dokumente/", "app/(app)/dokumente/"],
  inventory: ["lib/inventory/", "components/inventar/", "app/(app)/inventar/"],
  service: ["lib/installed-equipment/", "lib/service-cases/", "lib/maintenance/", "components/service/", "app/(app)/service/"],
  attention: ["lib/attention/", "components/aufgaben/", "app/(app)/aufgaben/"],
};

const auditDefinitions: readonly (readonly [string, string, readonly string[]])[] = [
  ["wave-1:a1", "wave-1/a1-grundstock.spec.ts", ["customers", "work", "planning", "personnel", "time", "documents", "inventory"]],
  ["wave-1:a2", "wave-1/a2-kunden.spec.ts", ["customers", "work", "documents", "attention"]],
  ["wave-1:a3", "wave-1/a3-personal.spec.ts", ["personnel", "time", "attention"]],
  ["wave-1:a4", "wave-1/a4-abwesenheit.spec.ts", ["personnel", "time", "planning", "documents", "attention"]],
  ["wave-1:a5", "wave-1/a5-aufgaben-qualifikationen.spec.ts", ["personnel", "attention", "time", "planning"]],
  ["wave-1:a6", "wave-1/a6-planung.spec.ts", ["planning", "work", "personnel", "time"]],
  ["wave-1:a7", "wave-1/a7-einsaetze.spec.ts", ["planning", "work", "personnel", "attention", "time"]],
  ["wave-2:p1-13", "wave-2/p1-13.spec.ts", ["work", "inventory", "personnel", "customers"]],
  ["wave-2:p1-14", "wave-2/p1-14.spec.ts", ["work", "planning", "time", "attention", "inventory"]],
  ["wave-2:p1-15", "wave-2/p1-15.spec.ts", ["work", "documents", "personnel", "attention", "time"]],
  ["wave-2:p1-16", "wave-2/p1-16.spec.ts", ["work", "planning", "time", "documents", "inventory", "customers"]],
  ["wave-2:p1-17", "wave-2/p1-17.spec.ts", ["work", "documents", "personnel", "customers"]],
  ["wave-2:p1-18", "wave-2/p1-18.spec.ts", ["service", "customers", "documents", "work"]],
  ["wave-2:p1-19", "wave-2/p1-19.spec.ts", ["service", "work", "planning", "customers", "documents", "attention"]],
  ["wave-2:p1-20", "wave-2/p1-20.spec.ts", ["service", "work", "planning", "customers", "documents", "attention"]],
  ["wave-2:p1-21", "wave-2/p1-21.spec.ts", ["time", "work", "personnel", "planning"]],
  ["wave-2:p1-22", "wave-2/p1-22.spec.ts", ["time", "personnel", "attention", "work", "planning"]],
  ["wave-2:p1-23", "wave-2/p1-23.spec.ts", ["time", "personnel", "documents"]],
  ["wave-2:p1-24", "wave-2/p1-24.spec.ts", ["personnel", "documents", "time", "work", "attention"]],
  ["layout", "layout/mobile-viewport.spec.ts", ["*"]],
  ["security:account", "security/account.spec.ts", ["*"]],
  ["list-pagination", "pagination/list-pagination.spec.ts", ["inventory", "documents", "work"]],
  // Measured navigation and view switches against the typical data profile (Step 2).
  ["performance:calendar", "performance/calendar.spec.ts", ["planning", "time", "customers", "work", "personnel"]],
  ["performance:lists", "performance/lists.spec.ts", ["customers", "work", "personnel"]],
  ["performance:calendar-live", "performance/calendar-live.spec.ts", ["planning", "time", "personnel"]],
  ["performance:planning", "performance/planning-benchmark.spec.ts", ["planning", "work", "personnel"]],
];

export function listTestFiles(repositoryRoot: string, directory: string, pattern: RegExp): string[] {
  const result: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(join(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (pattern.test(entry.name)) result.push(path);
    }
  }
  visit(directory);
  return result.sort();
}

export function getTestGroups(repositoryRoot: string): TestGroup[] {
  const groups: TestGroup[] = auditDefinitions.map(([id, file, scopes]) => ({
    id: `audit:${id}`, kind: "audit", files: [`tests/audit/${file}`], scopes,
    prerequisites: [], isolation: "group-world", timing: declaredTiming([`tests/audit/${file}`]),
  }));
  groups.push(
    { id: "golden:integrated", kind: "golden", files: listTestFiles(repositoryRoot, "tests/golden", /\.spec\.ts$/), scopes: ["*"], prerequisites: [], isolation: "integrated-world", timing: { requireFreshness: true, requireReadiness: true, exclusive: true } },
    { id: "ui:contracts", kind: "ui", files: listTestFiles(repositoryRoot, "tests/ui-contracts", /\.spec\.ts$/), scopes: ["*"], prerequisites: [], isolation: "process", timing: untimed },
    { id: "unit:all", kind: "unit", files: listTestFiles(repositoryRoot, "lib", /\.test\.(?:ts|tsx|mjs)$/), scopes: ["*"], prerequisites: [], isolation: "process", timing: untimed },
    { id: "canary:providers", kind: "canary", files: ["tests/canary/canary.spec.ts"], scopes: ["*"], prerequisites: [], isolation: "cloud-world", timing: declaredTiming(["tests/canary/canary.spec.ts"]) },
    { id: "canary:security", kind: "canary", files: ["tests/canary/security-boundaries.spec.ts"], scopes: ["*"], prerequisites: [], isolation: "cloud-world", timing: { ...untimed, exclusive: true } },
  );
  const goldenFiles = listTestFiles(repositoryRoot, "tests/golden", /\.spec\.ts$/);
  for (const file of goldenFiles) {
    const basename = file.split("/").at(-1)!.replace(".spec.ts", "");
    const sliceScopes = auditDefinitions.find(([id]) => id === `wave-2:${basename}`)?.[2];
    const earlyScopes: Readonly<Record<string, readonly string[]>> = {
      "p1-01": ["customers", "work"], "p1-03": ["personnel"], "p1-04": ["personnel", "time"],
      "p1-05": ["personnel", "attention"], "p1-06": ["personnel", "time", "planning"],
      "p1-07": ["attention", "personnel", "time"], "p1-08": ["personnel", "documents", "time"],
      "p1-09": ["personnel", "planning"], "p1-10": ["customers", "attention"],
      "p1-11": ["planning", "work"], "p1-12": ["planning", "work", "attention"],
    };
    const prerequisites = readGoldenPrerequisiteFiles(readFileSync(join(repositoryRoot, file), "utf8"), file)
      .map((required) => {
        if (!goldenFiles.includes(required)) throw new Error(`Unknown Golden prerequisite ${required} in ${file}`);
        return `golden:${required.split("/").at(-1)!.replace(".spec.ts", "")}`;
      });
    groups.push({ id: `golden:${basename}`, kind: "golden", files: [file], scopes: sliceScopes ?? earlyScopes[basename] ?? ["*"], prerequisites, isolation: "integrated-world", timing: declaredTiming([file]) });
  }
  for (const [slice, name] of [["21", "time_segments"], ["22", "time_corrections"], ["23", "time_accounts"], ["24", "people_lifecycle"]]) {
    groups.push({ id: `sql:p1-${slice}`, kind: "sql", files: [`supabase/tests/p1_${slice}_${name}.sql`], scopes: slice === "24" ? ["personnel", "documents", "time", "work"] : ["time", "personnel", "work"], prerequisites: [], isolation: "database-transaction", timing: untimed });
  }
  groups.push({ id: "sql:list-pagination", kind: "sql", files: ["supabase/tests/operational_list_pages.sql", "supabase/tests/inventory_pagination.sql"], scopes: ["customers", "work", "documents", "inventory"], prerequisites: [], isolation: "database-transaction", timing: untimed });
  groups.push({ id: "sql:security", kind: "sql", files: ["supabase/tests/security_boundaries.sql", "supabase/tests/email_change_boundaries.sql", "supabase/tests/event_ledger_boundaries.sql", "supabase/tests/realtime_deletions.sql"], scopes: ["*"], prerequisites: [], isolation: "database-transaction", timing: untimed });
  groups.push({ id: "static:dependencies", kind: "static", files: ["scripts/check-dependency-security.ts", "lib/security/dependency-exceptions.json", "bun.lock", "package.json"], scopes: ["*"], prerequisites: [], isolation: "process", timing: untimed, script: "security:dependencies" });
  for (const [id, file, script] of [["typecheck", "tsconfig.json", "typecheck"], ["lint", "eslint.config.mjs", "lint"], ["docs", "scripts/check-docs.ts", "docs:check"], ["coverage", "scripts/check-test-coverage.ts", "test:coverage"], ["unused", "knip.jsonc", "unused:check"]] as const) {
    groups.push({ id: `static:${id}`, kind: "static", files: [file], scopes: ["*"], prerequisites: [], isolation: "process", timing: untimed, script });
  }
  return groups;
}

export function readGoldenPrerequisiteFiles(source: string, file: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const prerequisites = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const values = new Map(node.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(parsed).replaceAll(/["']/g, ""), property.initializer]));
      const type = values.get("type");
      if (type && ts.isStringLiteral(type) && type.text === "requires-file") {
        const description = values.get("description");
        if (!description || !ts.isStringLiteral(description)) throw new Error(`Golden prerequisite must name a literal file in ${file}`);
        prerequisites.add(description.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return [...prerequisites];
}

/** Catch stale exact titles in the cheap coverage gate, before any browser world is created. */
export function validateNamedTestPrerequisites(source: string, file: string): string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const titles: { title: string; position: number }[] = [];
  const references: { title: string; position: number }[] = [];
  const problems: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "test") {
      const title = node.arguments[0];
      if (title && ts.isStringLiteralLike(title)) titles.push({ title: title.text, position: node.pos });
    }
    if (ts.isObjectLiteralExpression(node)) {
      const values = new Map(node.properties.filter(ts.isPropertyAssignment).map((property) => [property.name.getText(parsed).replaceAll(/["']/g, ""), property.initializer]));
      const type = values.get("type");
      if (type && ts.isStringLiteralLike(type) && type.text === "requires-test") {
        const description = values.get("description");
        let owner: ts.Node | undefined = node.parent;
        while (owner && !(ts.isCallExpression(owner) && ts.isIdentifier(owner.expression) && owner.expression.text === "test")) owner = owner.parent;
        if (!description || !ts.isStringLiteralLike(description) || !owner) problems.push(`${file}: requires-test must name a literal test title on its consuming test.`);
        else references.push({ title: description.text, position: owner.pos });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  for (const reference of references) {
    const [match, ...others] = titles.filter((test) => test.title === reference.title);
    if (!match || others.length) problems.push(`${file}: unknown or ambiguous requires-test title: ${reference.title}`);
    else if (match.position >= reference.position) problems.push(`${file}: requires-test must name an earlier producer: ${reference.title}`);
  }
  return problems;
}

/** Prerequisite groups execute in the same world, before the requested file. */
export function getGroupExecutionFiles(group: TestGroup, groups: readonly TestGroup[]): string[] {
  const files = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function add(current: TestGroup): void {
    if (visiting.has(current.id)) throw new Error(`Cyclic test prerequisite at ${current.id}`);
    if (visited.has(current.id)) return;
    visiting.add(current.id);
    for (const prerequisite of current.prerequisites) {
      const required = groups.find((candidate) => candidate.id === prerequisite);
      if (!required) throw new Error(`Unknown test prerequisite ${prerequisite}`);
      add(required);
    }
    for (const file of current.files) files.add(file);
    visiting.delete(current.id);
    visited.add(current.id);
  }
  add(group);
  return [...files];
}

/** Metadata pins required evidence; AST inspection also catches direct new timing calls. */
export function getGroupTimingRequirements(group: TestGroup, groups: readonly TestGroup[], repositoryRoot: string): GroupTimingRequirements {
  if (!["golden", "audit", "canary"].includes(group.kind)) return group.timing;
  const files = getGroupExecutionFiles(group, groups);
  const declared = declaredTiming(files);
  let requireFreshness = group.timing.requireFreshness || declared.requireFreshness;
  let requireReadiness = group.timing.requireReadiness || declared.requireReadiness;
  const requiredScenarios = [...(group.timing.requiredScenarios ?? []), ...(declared.requiredScenarios ?? [])];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(join(repositoryRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
    const sourceTiming = readSourceTiming(source);
    requireFreshness ||= sourceTiming.requireFreshness;
    requireReadiness ||= sourceTiming.requireReadiness;
    // A scenario call in source must be registered for this file, and a
    // registration must still have its call: neither can drift silently.
    const registered = new Set(scenariosForFiles([file]).map((scenario) => scenario.id));
    for (const id of sourceTiming.scenarioIds) {
      if (!registered.has(id)) throw new Error(`${file} measures unregistered scenario ${id}. Register it in lib/testing/measured-scenarios.ts before running.`);
    }
    for (const id of registered) {
      if (!sourceTiming.scenarioIds.has(id)) throw new Error(`Registered scenario ${id} is no longer measured in ${file}. Reconcile the registry before running.`);
    }
    const readinessSource = readinessSources[file];
    if (readinessSource && readinessSource !== file) {
      const imports = source.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
        if (!ts.isStringLiteral(declaration.moduleSpecifier)) return [];
        const specifier = declaration.moduleSpecifier.text;
        if (!specifier.startsWith(".")) return [];
        return [posix.normalize(`${dirname(file).replaceAll("\\", "/")}/${specifier}`).replace(/\.js$/, "")];
      });
      if (!imports.includes(readinessSource.replace(/\.ts$/, ""))) throw new Error(`Readiness owner ${file} no longer imports ${readinessSource}. Reconcile the timing registry before running.`);
      const helper = ts.createSourceFile(readinessSource, readFileSync(join(repositoryRoot, readinessSource), "utf8"), ts.ScriptTarget.Latest, true);
      if (!readSourceTiming(helper).requireReadiness) throw new Error(`Required opening-readiness measurement is missing from ${readinessSource}.`);
    }
  }
  return { requireFreshness, requireReadiness, requiredScenarios: [...new Set(requiredScenarios)], exclusive: group.timing.exclusive || requireFreshness || requireReadiness || requiredScenarios.length > 0 };
}

const SCENARIO_HELPERS = new Set(["expectUsableWithin", "expectScenarioLiveWithin"]);

function readSourceTiming(source: ts.SourceFile): Pick<GroupTimingRequirements, "requireFreshness" | "requireReadiness"> & { scenarioIds: Set<string> } {
  const readinessNames = new Set<string>();
  const scenarioNames = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === "expectReadyWithin") readinessNames.add(element.name.text);
      if (SCENARIO_HELPERS.has(imported)) scenarioNames.add(element.name.text);
    }
  }
  let requireFreshness = false;
  let requireReadiness = false;
  const scenarioIds = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const title = node.arguments[0];
      if (title && ts.isStringLiteralLike(title) && /@FRESHNESS\b/.test(title.text)) requireFreshness = true;
      if (ts.isIdentifier(node.expression) && readinessNames.has(node.expression.text)) requireReadiness = true;
      if (ts.isIdentifier(node.expression) && scenarioNames.has(node.expression.text)) {
        // The scenario id must be a literal so the registry check stays static.
        if (!title || !ts.isStringLiteralLike(title)) throw new Error(`${source.fileName}: a measured scenario id must be a string literal.`);
        scenarioIds.add(title.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { requireFreshness, requireReadiness, scenarioIds };
}

export function validateTestGroupInventory(groups: readonly TestGroup[], discoveredFiles: readonly string[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  for (const group of groups) {
    if (ids.has(group.id)) problems.push(`Duplicate test group: ${group.id}`);
    ids.add(group.id);
    if (!group.files.length || !group.scopes.length) problems.push(`Empty files or scopes: ${group.id}`);
    for (const file of group.files) {
      const owner = owners.get(file);
      if (owner && owner !== "golden:integrated" && group.id !== "golden:integrated") problems.push(`Test file has two owners: ${file} (${owner}, ${group.id})`);
      owners.set(file, group.id);
    }
  }
  for (const group of groups) {
    for (const prerequisite of group.prerequisites) {
      if (!ids.has(prerequisite)) problems.push(`Unknown prerequisite ${prerequisite} in ${group.id}`);
    }
  }
  for (const file of discoveredFiles) if (!owners.has(file)) problems.push(`Unregistered test file: ${file}`);
  return problems;
}
