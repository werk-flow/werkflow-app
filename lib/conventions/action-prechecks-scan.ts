import { posix } from 'node:path';
import ts from 'typescript';
import type { ActionPrecheck, ExportReference } from '@/lib/ui/action-prechecks';

// The pure scanner behind lib/conventions/action-prechecks.test.ts. It reads
// source texts only, so the test can plant a defect without touching the tree.

/** Repository-relative path (forward slashes) to file text. */
export type RepositoryText = ReadonlyMap<string, string>;

/** A client file that imports a refusable action and pairs it with nothing. */
export type UnpairedView = {
  readonly file: string;
  readonly kind: string;
  readonly actions: readonly string[];
};

type ImportedName = { readonly module: string; readonly name: string };

type SourceFacts = {
  readonly imports: readonly ImportedName[];
  /** Prop names the file declares in a type or destructures from a parameter. */
  readonly props: ReadonlySet<string>;
  /** Background read kinds the file passes to `readInBackground`. */
  readonly readKinds: ReadonlySet<string>;
};

const SOURCE_FILE = /\.tsx?$/;
const DEFAULT_VIEW_ROOTS: readonly string[] = ['app/', 'components/', 'hooks/'];
const MINIMUM_REASON_LENGTH = 30;

function withoutExtension(path: string): string {
  return path.replace(/\.(tsx?|mjs)$/, '');
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  return null;
}

function collectImport(path: string, node: ts.ImportDeclaration, imports: ImportedName[]): void {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return;
  const modulePath = resolveSpecifier(path, node.moduleSpecifier.text);
  const clause = node.importClause;
  const bindings = clause?.namedBindings;
  if (!modulePath || !clause || clause.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) return;
  for (const element of bindings.elements) {
    if (!element.isTypeOnly)
      imports.push({ module: modulePath, name: (element.propertyName ?? element.name).text });
  }
}

function parameterPropName(node: ts.BindingElement): string | null {
  if (!ts.isParameter(node.parent.parent)) return null;
  const key = node.propertyName ?? node.name;
  return ts.isIdentifier(key) ? key.text : null;
}

function parseSource(path: string, text: string): SourceFacts {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: ImportedName[] = [];
  const props = new Set<string>();
  const readKinds = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) collectImport(path, node, imports);
    if (ts.isPropertySignature(node) && ts.isIdentifier(node.name)) props.add(node.name.text);
    if (ts.isBindingElement(node)) {
      const name = parameterPropName(node);
      if (name) props.add(name);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const [kind] = node.arguments;
      if (node.expression.text === 'readInBackground' && kind && ts.isStringLiteralLike(kind))
        readKinds.add(kind.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, props, readKinds };
}

function importsExport(facts: SourceFacts, reference: ExportReference): boolean {
  const modulePath = withoutExtension(reference.module);
  return facts.imports.some((entry) => entry.module === modulePath && entry.name === reference.exportName);
}

function definesExport(text: string, name: string): boolean {
  return new RegExp(
    `export\\s+(?:async\\s+)?(?:function\\s*\\*?\\s*|const\\s+|let\\s+|class\\s+)${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
  ).test(text);
}

function factsOf(repository: RepositoryText): Map<string, SourceFacts> {
  const facts = new Map<string, SourceFacts>();
  for (const [path, text] of repository) {
    if (SOURCE_FILE.test(path)) facts.set(path, parseSource(path, text));
  }
  return facts;
}

function importersByModule(facts: ReadonlyMap<string, SourceFacts>): Map<string, string[]> {
  const importers = new Map<string, string[]>();
  for (const [path, fileFacts] of facts) {
    for (const entry of fileFacts.imports) {
      const list = importers.get(entry.module) ?? [];
      if (!list.includes(path)) list.push(path);
      importers.set(entry.module, list);
    }
  }
  return importers;
}

/**
 * Every client file under the row's view roots that imports one of the row's
 * actions and neither imports the row's predicate (or a wrapper of it),
 * declares one of the row's props, reads one of its screened background
 * kinds, nor is exempt. A file whose every value importer is covered counts
 * as covered: a hook that only paired views call inherits their check.
 */
export function findUnpairedActionViews(
  repository: RepositoryText,
  table: readonly ActionPrecheck[],
): UnpairedView[] {
  const facts = factsOf(repository);
  const importers = importersByModule(facts);
  const findings: UnpairedView[] = [];
  for (const row of table) {
    const checks = [row.predicate, ...row.wrappers];
    const directlyPaired = (path: string, fileFacts: SourceFacts): boolean =>
      path in row.exempt ||
      checks.some((check) => importsExport(fileFacts, check)) ||
      row.props.some((prop) => fileFacts.props.has(prop)) ||
      row.screenedReads.some((kind) => fileFacts.readKinds.has(kind));
    const memo = new Map<string, boolean>();
    const covered = (path: string, visiting: ReadonlySet<string>): boolean => {
      const known = memo.get(path);
      if (known !== undefined) return known;
      const fileFacts = facts.get(path);
      if (!fileFacts || visiting.has(path)) return false;
      const callers = importers.get(withoutExtension(path)) ?? [];
      const next = new Set(visiting).add(path);
      const result =
        directlyPaired(path, fileFacts) ||
        (callers.length > 0 && callers.every((caller) => covered(caller, next)));
      memo.set(path, result);
      return result;
    };
    const roots = row.views ?? DEFAULT_VIEW_ROOTS;
    for (const [path, fileFacts] of facts) {
      if (!roots.some((root) => path.startsWith(root))) continue;
      const used = row.actions.filter((action) => importsExport(fileFacts, action));
      if (used.length === 0 || covered(path, new Set())) continue;
      findings.push({ file: path, kind: row.kind, actions: used.map((action) => action.exportName) });
    }
  }
  return findings;
}

function codeOccurs(text: string, code: string): boolean {
  return new RegExp(`\\b${code}\\b`).test(text);
}

function referenceProblems(repository: RepositoryText, kind: string, reference: ExportReference): string[] {
  const text = repository.get(reference.module);
  if (text === undefined) return [`${kind}: ${reference.module} does not exist`];
  return definesExport(text, reference.exportName)
    ? []
    : [`${kind}: ${reference.module} does not export ${reference.exportName}`];
}

/** True when the module defines the export or imports it by name. */
function usesExport(
  repository: RepositoryText,
  facts: ReadonlyMap<string, SourceFacts>,
  modulePath: string,
  reference: ExportReference,
): boolean {
  const moduleFacts = facts.get(modulePath);
  return (
    (modulePath === reference.module &&
      definesExport(repository.get(modulePath) ?? '', reference.exportName)) ||
    (moduleFacts !== undefined && importsExport(moduleFacts, reference))
  );
}

function sqlProblems(repository: RepositoryText, row: ActionPrecheck, testPath: string): string[] {
  const test = repository.get(testPath);
  if (test === undefined) return [`${row.kind}: ${testPath} does not exist`];
  const migrations = [...repository].filter(([path]) => path.startsWith('supabase/migrations/'));
  return row.serverCodes
    .filter((code) => migrations.some(([, text]) => codeOccurs(text, code)) && !codeOccurs(test, code))
    .map((code) => `${row.kind}: ${testPath} does not assert the database refusal ${code}`);
}

function serverProblems(
  repository: RepositoryText,
  facts: ReadonlyMap<string, SourceFacts>,
  row: ActionPrecheck,
): string[] {
  const { server } = row;
  if (server.kind === 'reviewed') {
    return server.reason.length >= MINIMUM_REASON_LENGTH
      ? []
      : [
          `${row.kind}: the reviewed server rule needs a reason of ${MINIMUM_REASON_LENGTH} or more characters`,
        ];
  }
  if (server.kind === 'sql') return sqlProblems(repository, row, server.test);
  const problems = server.guards.flatMap((guard) => [
    ...referenceProblems(repository, row.kind, guard),
    ...(usesExport(repository, facts, guard.module, row.predicate)
      ? []
      : [`${row.kind}: the server guard ${guard.exportName} does not use ${row.predicate.exportName}`]),
  ]);
  for (const modulePath of new Set(row.actions.map((action) => action.module))) {
    const owned =
      usesExport(repository, facts, modulePath, row.predicate) ||
      server.guards.some((guard) => usesExport(repository, facts, modulePath, guard));
    if (!owned)
      problems.push(
        `${row.kind}: ${modulePath} uses neither ${row.predicate.exportName} nor a listed server guard`,
      );
  }
  return problems;
}

/** Wrappers whose module reaches the predicate neither directly nor through another wrapper of the row. */
function ungroundedWrappers(
  repository: RepositoryText,
  facts: ReadonlyMap<string, SourceFacts>,
  row: ActionPrecheck,
): ExportReference[] {
  const grounded: ExportReference[] = [row.predicate];
  let remaining = [...row.wrappers];
  let progressed = true;
  while (progressed) {
    const reached = remaining.filter((wrapper) =>
      grounded.some((check) => usesExport(repository, facts, wrapper.module, check)),
    );
    grounded.push(...reached);
    remaining = remaining.filter((wrapper) => !reached.includes(wrapper));
    progressed = reached.length > 0;
  }
  return remaining;
}

function exemptionProblems(facts: ReadonlyMap<string, SourceFacts>, row: ActionPrecheck): string[] {
  return Object.entries(row.exempt).flatMap(([file, reason]) => {
    const fileFacts = facts.get(file);
    return [
      ...(reason.length < MINIMUM_REASON_LENGTH
        ? [
            `${row.kind}: the exemption of ${file} needs a reason of ${MINIMUM_REASON_LENGTH} or more characters`,
          ]
        : []),
      ...(!fileFacts || !row.actions.some((action) => importsExport(fileFacts, action))
        ? [`${row.kind}: ${file} is exempt but imports none of the row's actions`]
        : []),
    ];
  });
}

/**
 * Problems of the table itself: a refusal code nothing raises, a missing
 * export, a wrapper that does not use the predicate, a server side that does
 * not own the rule, an unknown read kind, a stale or unreasoned exemption.
 */
export function findPrecheckTableProblems(
  repository: RepositoryText,
  table: readonly ActionPrecheck[],
): string[] {
  const facts = factsOf(repository);
  const raisers = [...repository].filter(
    ([path]) =>
      (path.startsWith('lib/') && SOURCE_FILE.test(path)) || path.startsWith('supabase/migrations/'),
  );
  const backgroundReads = repository.get('lib/data/background-reads.ts') ?? '';
  const problems: string[] = [];
  for (const row of table) {
    for (const code of row.serverCodes) {
      if (!raisers.some(([, text]) => codeOccurs(text, code)))
        problems.push(`${row.kind}: no file under lib/ or supabase/migrations/ names ${code}`);
    }
    for (const reference of [row.predicate, ...row.wrappers, ...row.actions])
      problems.push(...referenceProblems(repository, row.kind, reference));
    for (const wrapper of ungroundedWrappers(repository, facts, row))
      problems.push(
        `${row.kind}: the wrapper ${wrapper.exportName} does not use ${row.predicate.exportName}`,
      );
    problems.push(...serverProblems(repository, facts, row));
    for (const kind of row.screenedReads) {
      if (!backgroundReads.includes(`'${kind}': defineRead(`))
        problems.push(`${row.kind}: ${kind} is not a background read kind`);
    }
    problems.push(...exemptionProblems(facts, row));
  }
  return problems;
}
