// Mechanical rules for the six virtues (AGENTS.md, "How to read the virtues"):
// every owner doc carries the same five sections, every checklist and "Never"
// item names the mechanism that catches it, every named mechanism exists, and
// every custom lint rule and convention test is named by at least one doc.

const STANDARD_SECTIONS = ['How to work', 'Checklist', 'Never', 'Verify your work', 'Examples'] as const;
export type StandardSection = (typeof STANDARD_SECTIONS)[number];

const MECHANISM_KINDS = ['lint', 'test', 'group', 'script', 'code', 'judgment'] as const;
export type MechanismKind = (typeof MECHANISM_KINDS)[number];

export type Mechanism = { kind: MechanismKind; target: string | null };

/** `head` is the item's first line; `text` adds its indented continuation lines. */
export type StandardItem = { line: number; head: string; text: string };

/** Answers whether a named mechanism exists; check-docs builds it from the repository. */
export type MechanismResolver = {
  lintNameExists: (name: string) => boolean;
  pathExists: (path: string) => boolean;
  groupExists: (id: string) => boolean;
  scriptExists: (name: string) => boolean;
};

const ITEM_PATTERN = /^(?:-|\d+\.) (.*)$/;
const CONTINUATION_PATTERN = /^ {2,}\S/;
const TAG_PATTERN = /\[([^\]]+)\]\s*$/;
const RUN_SCRIPT_PATTERN = /\bbun run ([a-z][a-z:-]*)/g;

/**
 * The top-level list items of each standard section, keyed by section name.
 * A section is an `##` heading with exactly the section's name; it ends at the
 * next `#` or `##` heading. Indented lines continue the item above them.
 */
export function readStandardSections(markdown: string): Map<StandardSection, StandardItem[]> {
  const sections = new Map<StandardSection, StandardItem[]>();
  let current: StandardItem[] | null = null;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const heading = line.match(/^#{1,2} (.+?)\s*$/);
    if (heading) {
      const name = STANDARD_SECTIONS.find((section) => section === heading[1]);
      current = name === undefined ? null : [];
      if (name !== undefined && current) sections.set(name, current);
      return;
    }
    if (!current) return;
    const item = line.match(ITEM_PATTERN);
    if (item?.[1] !== undefined) {
      current.push({ line: index + 1, head: item[1], text: item[1] });
      return;
    }
    const previous = current.at(-1);
    if (previous && CONTINUATION_PATTERN.test(line)) previous.text = `${previous.text} ${line.trim()}`;
  });
  return sections;
}

/**
 * The mechanisms named by an item's trailing tag, such as
 * "[lint `ui/no-raw-controls`, test `lib/ui/field-contracts.test.tsx`]" or
 * "[judgment]". Returns null when the item ends without a tag or a part of the
 * tag is not `<kind> \`<target>\`` (judgment may omit the target).
 */
export function parseMechanismTag(text: string): Mechanism[] | null {
  const tag = text.match(TAG_PATTERN)?.[1];
  if (tag === undefined) return null;
  const mechanisms: Mechanism[] = [];
  for (const part of tag.split(/,\s*(?=[a-z]+\b)/)) {
    const match = part.trim().match(/^([a-z]+)(?: `([^`]+)`)?$/);
    const kind = MECHANISM_KINDS.find((candidate) => candidate === match?.[1]);
    if (!match || kind === undefined) return null;
    const target = match[2] ?? null;
    if (kind !== 'judgment' && target === null) return null;
    mechanisms.push({ kind, target });
  }
  return mechanisms;
}

function mechanismProblem(mechanism: Mechanism, resolver: MechanismResolver): string | null {
  const { kind, target } = mechanism;
  if (target === null) return null;
  switch (kind) {
    case 'lint':
      return resolver.lintNameExists(target)
        ? null
        : `lint rule ${target} is not in the ESLint configuration`;
    case 'test':
    case 'code':
      return resolver.pathExists(target) ? null : `${kind} ${target} does not exist`;
    case 'group':
      return resolver.groupExists(target) ? null : `group ${target} is not a registered test group`;
    case 'script':
      return resolver.scriptExists(target.replace(/^bun run /, '').split(' ')[0] ?? '')
        ? null
        : `script ${target} is not a package.json script`;
    case 'judgment':
      return null;
  }
}

/**
 * Problems with one owner doc's standard: a missing or empty section, a
 * checklist or "Never" item without a valid mechanism tag, a mechanism that
 * names nothing, an example whose leading path does not exist, and a
 * `bun run` command that names no package script.
 */
export function findStandardProblems(markdown: string, resolver: MechanismResolver): string[] {
  const problems: string[] = [];
  const sections = readStandardSections(markdown);
  for (const name of STANDARD_SECTIONS) {
    const items = sections.get(name);
    if (!items || items.length === 0) {
      problems.push(`section "## ${name}" is missing or has no list item`);
      continue;
    }
    for (const item of items) {
      for (const match of item.text.matchAll(RUN_SCRIPT_PATTERN)) {
        const script = match[1];
        if (script !== undefined && !resolver.scriptExists(script))
          problems.push(`line ${item.line}: bun run ${script} is not a package.json script`);
      }
      if (name === 'Examples') {
        const path = item.text.match(/^`([^`]+)`/)?.[1];
        if (path === undefined || !resolver.pathExists(path))
          problems.push(`line ${item.line}: an example starts with the backticked path of an existing file`);
        continue;
      }
      // Procedure steps need no mechanism tag.
      if (name === 'Verify your work' || name === 'How to work') continue;
      // A tag closes the item, or its first line when an indented sub-list follows.
      const mechanisms = parseMechanismTag(item.text) ?? parseMechanismTag(item.head);
      if (mechanisms === null) {
        problems.push(
          `line ${item.line}: end the item with a mechanism tag such as [lint \`name\`], [test \`path\`] or [judgment]`,
        );
        continue;
      }
      for (const mechanism of mechanisms) {
        const problem = mechanismProblem(mechanism, resolver);
        if (problem) problems.push(`line ${item.line}: ${problem}`);
      }
    }
  }
  return problems;
}

/** Mechanism counts per kind across the "Checklist" and "Never" sections. */
export function countMechanisms(markdown: string): Record<MechanismKind, number> {
  const counts: Record<MechanismKind, number> = {
    lint: 0,
    test: 0,
    group: 0,
    script: 0,
    code: 0,
    judgment: 0,
  };
  const sections = readStandardSections(markdown);
  for (const name of ['Checklist', 'Never'] as const) {
    for (const item of sections.get(name) ?? []) {
      const mechanisms = parseMechanismTag(item.text) ?? parseMechanismTag(item.head) ?? [];
      for (const mechanism of mechanisms) counts[mechanism.kind] += 1;
    }
  }
  return counts;
}

export type EnforcedByReference = { line: number; token: string; problem: string };

const GROUP_ID_PATTERN = /^(?:static|sql|ui|unit|canary|audit|golden):[a-z0-9:<>*-]+$/;
const LINT_NAME_PATTERN =
  /^(?:ui|playwright-spec|@typescript-eslint|@eslint-community\/eslint-comments)\/[a-z-]+$/;
const PATH_PATTERN =
  /^\.?[A-Za-z0-9_()[\].-]+(?:\/[A-Za-z0-9_()[\].*-]*)+$|^[\w.-]+\.(?:ts|tsx|mjs|json|css|sql|toml|jsonc)$/;

/**
 * Backticked mechanism names on the "Enforced by" lines of AGENTS.md that do
 * not resolve: a path that does not exist, a lint rule that the ESLint
 * configuration does not name, a group that is not registered, or a
 * `bun run` script that package.json does not declare. Other backticked
 * tokens (symbols, flags) are not checked.
 */
export function findEnforcedByProblems(markdown: string, resolver: MechanismResolver): EnforcedByReference[] {
  const problems: EnforcedByReference[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (!/^- \*\*Enforced by\.\*\*/.test(line)) return;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const token = match[1];
      if (token === undefined) continue;
      const report = (problem: string): void => {
        problems.push({ line: index + 1, token, problem });
      };
      if (token.startsWith('bun run ')) {
        const script = token.slice('bun run '.length).split(' ')[0] ?? '';
        if (!resolver.scriptExists(script)) report('is not a package.json script');
      } else if (GROUP_ID_PATTERN.test(token)) {
        if (!resolver.groupExists(token)) report('is not a registered test group');
      } else if (LINT_NAME_PATTERN.test(token)) {
        if (!resolver.lintNameExists(token)) report('is not in the ESLint configuration');
      } else if (PATH_PATTERN.test(token)) {
        if (!resolver.pathExists(token.replace(/\*.*$/, ''))) report('does not exist');
      }
    }
  });
  return problems;
}

/** The rule names a local ESLint plugin module declares in its `rules: { ... }` object. */
export function declaredLintRuleNames(pluginSource: string): string[] {
  const block = pluginSource.match(/\brules:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  return [...block.matchAll(/^\s*'([a-z][a-z-]*)':/gm)].flatMap((match) => match[1] ?? []);
}

/**
 * The `no-restricted-syntax` selector sets that eslint.config.mjs declares at
 * module level: every `const <name>Selector(s) = ` binding that defines a
 * selector itself. A set composed only of other sets is not a mechanism.
 */
export function declaredSelectorSetNames(configSource: string): string[] {
  // A binding's text runs to the next top-level declaration, comment or blank line.
  const binding = /^const ([A-Za-z]+Selectors?) = ([\s\S]*?)(?=\n(?:const |function |\/\/|\n)|$(?![\s\S]))/gm;
  return [...configSource.matchAll(binding)].flatMap((match) =>
    match[1] !== undefined && match[2]?.includes('selector:') ? [match[1]] : [],
  );
}

/** A test file in any language the unit runner executes. */
export const TEST_FILE_PATTERN = /\.test\.(?:tsx?|mjs)$/;

/**
 * Whether a test under lib/testing/ enforces a rule on authors of specs,
 * groups, references or publication, as opposed to a unit test of the
 * runner's own machinery. Such a test opens with a `// Rule test: ` line.
 */
export function isRuleTest(source: string): boolean {
  return /^\/\/ Rule test: \S/.test(source);
}

/** The mechanisms whose name appears nowhere in the documentation corpus. */
export function findUnreferencedMechanisms(mechanisms: readonly string[], corpus: string): string[] {
  return mechanisms.filter((mechanism) => !corpus.includes(mechanism));
}
