// Mechanical rules for the six virtues (AGENTS.md, "How to read the virtues"):
// every owner doc carries the same five sections, every checklist and "Never"
// item names the mechanism that catches it, every named mechanism exists, every
// custom lint rule and convention test is named by at least one doc, and each
// virtue's "Enforced by" line in AGENTS.md agrees with its owner docs' tags.

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
  /** Whether a relative Markdown link target resolves from the document being checked. */
  linkExists: (target: string) => boolean;
};

const ITEM_PATTERN = /^(?:-|\d+\.) (.*)$/;
const CONTINUATION_PATTERN = /^ {2,}\S/;
const TAG_PATTERN = /\[([^\]]+)\]\s*$/;
const RUN_SCRIPT_PATTERN = /\bbun run ([a-z][a-z:-]*)/g;
const EXAMPLE_PATH_PATTERN = /^`([^`]+)`/;
const EXAMPLE_LINK_PATTERN = /^\[[^\]]+\]\(([^)\s#]+)(?:#[^)\s]*)?\)/;

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

function scriptName(target: string): string {
  return target.replace(/^bun run /, '').split(' ')[0] ?? '';
}

/** Why a named mechanism does not resolve, or null when it does. */
function mechanismFailure(mechanism: Mechanism, resolver: MechanismResolver): string | null {
  const { kind, target } = mechanism;
  if (target === null) return null;
  switch (kind) {
    case 'lint':
      return resolver.lintNameExists(target)
        ? null
        : 'is not an enabled rule or a selector set of the ESLint configuration';
    case 'test':
    case 'code':
      return resolver.pathExists(target.replace(/\*.*$/, '')) ? null : 'does not exist';
    case 'group':
      return resolver.groupExists(target) ? null : 'is not a registered test group';
    case 'script':
      return resolver.scriptExists(scriptName(target)) ? null : 'is not a package.json script';
    case 'judgment':
      return null;
  }
}

/** The mechanisms an item's tag names: the tag closes the item, or its first line when a sub-list follows. */
function itemMechanisms(item: StandardItem): Mechanism[] | null {
  return parseMechanismTag(item.text) ?? parseMechanismTag(item.head);
}

function exampleProblem(item: StandardItem, resolver: MechanismResolver): string | null {
  const path = item.text.match(EXAMPLE_PATH_PATTERN)?.[1];
  if (path !== undefined) return resolver.pathExists(path) ? null : `${path} does not exist`;
  const link = item.text.match(EXAMPLE_LINK_PATTERN)?.[1];
  if (link !== undefined) return resolver.linkExists(link) ? null : `${link} does not resolve`;
  return 'an example starts with the backticked path of an existing file or a link to an existing document';
}

/**
 * Problems with one owner doc's standard: a missing or empty section, a
 * checklist or "Never" item without a valid mechanism tag, a mechanism that
 * names nothing, an example that does not start with an existing file, and a
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
        const problem = exampleProblem(item, resolver);
        if (problem !== null) problems.push(`line ${item.line}: ${problem}`);
        continue;
      }
      // Procedure steps need no mechanism tag.
      if (name === 'Verify your work' || name === 'How to work') continue;
      const mechanisms = itemMechanisms(item);
      if (mechanisms === null) {
        problems.push(
          `line ${item.line}: end the item with a mechanism tag such as [lint \`name\`], [test \`path\`] or [judgment]`,
        );
        continue;
      }
      for (const mechanism of mechanisms) {
        const failure = mechanismFailure(mechanism, resolver);
        if (failure !== null)
          problems.push(`line ${item.line}: ${mechanism.kind} ${mechanism.target ?? ''} ${failure}`);
      }
    }
  }
  return problems;
}

/** The mechanisms tagged across the "Checklist" and "Never" sections, one entry per tag part. */
function readTaggedMechanisms(markdown: string): Mechanism[] {
  const sections = readStandardSections(markdown);
  return (['Checklist', 'Never'] as const).flatMap((name) =>
    (sections.get(name) ?? []).flatMap((item) => itemMechanisms(item) ?? []),
  );
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
  for (const mechanism of readTaggedMechanisms(markdown)) counts[mechanism.kind] += 1;
  return counts;
}

export type EnforcedByReference = { line: number; token: string; problem: string };

const ENFORCED_BY_PATTERN = /^- \*\*Enforced by\.\*\*/;
const GROUP_ID_PATTERN = /^(?:static|sql|ui|unit|canary|audit|golden):[a-z0-9:<>*-]+$/;
const SCRIPT_NAME_PATTERN = /^[a-z][a-z-]*:[a-z][a-z:-]*$/;
const LINT_NAME_PATTERN =
  /^(?:ui|quality|realtime|playwright-spec|jsx-a11y|@typescript-eslint|@eslint-community\/eslint-comments)\/[a-z-]+$/;
const SELECTOR_SET_PATTERN = /^[a-z][A-Za-z]*Selectors?$/;
const PATH_PATTERN =
  /^\.?[A-Za-z0-9_()[\].-]+(?:\/[A-Za-z0-9_()[\].*-]*)+$|^[\w.-]+\.(?:ts|tsx|mjs|json|css|sql|toml|jsonc)$/;

/**
 * The mechanism a backticked token on an "Enforced by" line names: a `bun run`
 * script or a bare script name, a test group, a lint rule or selector set, or a
 * repository path. Other tokens (symbols, flags) name no mechanism.
 */
export function classifyMechanismToken(token: string): Mechanism | null {
  if (token.startsWith('bun run ')) return { kind: 'script', target: scriptName(token) };
  if (GROUP_ID_PATTERN.test(token)) return { kind: 'group', target: token };
  if (SCRIPT_NAME_PATTERN.test(token)) return { kind: 'script', target: token };
  if (LINT_NAME_PATTERN.test(token) || SELECTOR_SET_PATTERN.test(token))
    return { kind: 'lint', target: token };
  if (PATH_PATTERN.test(token)) return { kind: 'code', target: token };
  return null;
}

function enforcedByTokens(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].flatMap((match) => match[1] ?? []);
}

/**
 * Backticked mechanism names on the "Enforced by" lines of AGENTS.md that do
 * not resolve: a path that does not exist, a lint rule that the ESLint
 * configuration does not enable, a group that is not registered, or a script
 * that package.json does not declare.
 */
export function findEnforcedByProblems(markdown: string, resolver: MechanismResolver): EnforcedByReference[] {
  const problems: EnforcedByReference[] = [];
  markdown.split(/\r?\n/).forEach((line, index) => {
    if (!ENFORCED_BY_PATTERN.test(line)) return;
    for (const token of enforcedByTokens(line)) {
      const mechanism = classifyMechanismToken(token);
      const failure = mechanism === null ? null : mechanismFailure(mechanism, resolver);
      if (failure !== null) problems.push({ line: index + 1, token, problem: failure });
    }
  });
  return problems;
}

/** One numbered virtue block of AGENTS.md: its "Enforced by" line and the owner docs it names. */
export type VirtueBlock = { virtue: number; line: number; tokens: string[]; ownerDocs: string[] };

/**
 * The six virtue blocks: each `### N. Title` section with its "Enforced by"
 * line and the repository paths of the Markdown files its "Owner doc" line
 * links or names in backticks.
 */
export function readVirtueBlocks(agentsMarkdown: string): VirtueBlock[] {
  const blocks: VirtueBlock[] = [];
  let current: VirtueBlock | null = null;
  agentsMarkdown.split(/\r?\n/).forEach((line, index) => {
    const heading = line.match(/^### (\d+)\. /);
    if (heading?.[1] !== undefined) {
      current = { virtue: Number(heading[1]), line: index + 1, tokens: [], ownerDocs: [] };
      blocks.push(current);
      return;
    }
    if (line.startsWith('#')) current = null;
    if (current === null) return;
    if (ENFORCED_BY_PATTERN.test(line)) {
      current.line = index + 1;
      current.tokens = enforcedByTokens(line);
    }
    if (line.startsWith('- **Owner doc.**')) {
      // The owners come first; ", with ..." adds companion docs and ". Start from ..." the entry point.
      const owners = line.split(/, with |\. Start from /)[0] ?? '';
      const named = [
        ...[...owners.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].flatMap((match) => match[1] ?? []),
        ...[...owners.matchAll(/`([^`]+\.md)`/g)].flatMap((match) => match[1] ?? []),
      ];
      current.ownerDocs = [...new Set(named)];
    }
  });
  return blocks;
}

function pathPrefix(target: string): string {
  const wildcard = target.search(/[*<]/);
  return wildcard === -1 ? target : target.slice(0, wildcard);
}

function isPathKind(kind: MechanismKind): boolean {
  return kind === 'test' || kind === 'code';
}

/** Whether an "Enforced by" token names the tagged mechanism itself or a family that holds it. */
function tokenCoversTag(token: Mechanism, tag: Mechanism): boolean {
  if (token.target === null || tag.target === null) return false;
  if (isPathKind(token.kind) && isPathKind(tag.kind)) {
    return token.target.endsWith('/') ? tag.target.startsWith(token.target) : token.target === tag.target;
  }
  if (token.kind === 'group' && tag.kind === 'lint') return token.target === 'static:lint';
  if (token.kind !== tag.kind) return false;
  if (token.kind === 'script') return scriptName(token.target) === scriptName(tag.target);
  if (token.kind === 'group') {
    // `audit:lab:*` holds every group under its prefix; `audit:layout` itself and its `audit:layout:` family.
    const wildcard = /[*<]/.test(token.target);
    return wildcard
      ? pathPrefix(tag.target).startsWith(pathPrefix(token.target))
      : tag.target === token.target || tag.target.startsWith(`${token.target}:`);
  }
  return token.target === tag.target;
}

/**
 * Where a virtue's "Enforced by" line and its owner docs disagree: a mechanism
 * the line names that no owner-doc item tags, and a tagged mechanism that the
 * line neither names nor covers by its folder, its group family or `static:lint`.
 */
export function findVirtueAgreementProblems(
  block: VirtueBlock,
  ownerDocMarkdown: readonly string[],
): string[] {
  const tags = ownerDocMarkdown
    .flatMap((markdown) => readTaggedMechanisms(markdown))
    .filter((tag) => tag.kind !== 'judgment');
  const tokens = block.tokens.flatMap((token) => {
    const mechanism = classifyMechanismToken(token);
    return mechanism === null ? [] : [{ token, mechanism }];
  });
  const problems: string[] = [];
  for (const { token, mechanism } of tokens) {
    if (!tags.some((tag) => tokenCoversTag(mechanism, tag)))
      problems.push(
        `virtue ${block.virtue} (AGENTS.md:${block.line}) names \`${token}\`, which no item of its owner docs tags`,
      );
  }
  const reported = new Set<string>();
  for (const tag of tags) {
    const key = `${tag.kind} ${tag.target ?? ''}`;
    if (reported.has(key) || tokens.some(({ mechanism }) => tokenCoversTag(mechanism, tag))) continue;
    reported.add(key);
    problems.push(
      `virtue ${block.virtue}: its owner docs tag ${key}, which the "Enforced by" line (AGENTS.md:${block.line}) neither names nor covers`,
    );
  }
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
