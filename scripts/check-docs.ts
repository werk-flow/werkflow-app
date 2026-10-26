// Validates the documentation so that drift fails loudly instead of rotting silently.
// Run with: bun run docs:check
//
// This script reads the repository and hands the text to the rules in lib/docs/, which hold the
// logic and its tests. Each problem line starts with the rule's area:
//   index, link, skills, coderabbit, status, link-syntax, roadmap, spec-review, slices, catalog,
//   incident-tier, deletion-pass, durable-homes, closed-banner, guidance,
//   dated, budget, review-stamp, decision, virtue, citation, route-handler, numbered-rule,
//   german-quote, path, one-home, workspace, capture.
// The numbers and exemptions come from lib/docs/doc-policy.ts, which decision 0004 pins.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { ESLint } from 'eslint';
import { getBusinessTodayIso } from '../lib/date-time/berlin';
import { findCodeRabbitInstructionViolations } from '../lib/testing/publication/coderabbit-review-command';
import { markdownHeadingAnchors } from '../lib/docs/heading-anchors';
import { findSliceRecordProblems } from '../lib/docs/slice-records';
import {
  countWords,
  findBacktickedDocPaths,
  findCommitHashLines,
  findDatedLines,
  findDocumentReferences,
  findMismatchedGermanQuotes,
} from '../lib/docs/living-doc-rules';
import {
  findMarkdownFileLinks,
  findSkillCopyDifferences,
  readSharedSkills,
  SIBLING_REPOSITORIES,
  siblingOfWorkspacePath,
  skillCopyFolders,
  type SiblingRepository,
} from '../lib/docs/workspace-links';
import { findDocCitations, isCitationCheckedFile } from '../lib/docs/code-citations';
import {
  checkRoadmapRows,
  findRoadmapCounterProblems,
  findStaleSpecReviews,
  readLogEntries,
  readRoadmapRows,
} from '../lib/docs/roadmap-rules';
import {
  CLOSED_RECORD_BANNER,
  CLOSED_RECORD_BANNER_LINE,
  hasClosedRecordBanner,
} from '../lib/docs/closed-records';
import { findCaptureCitationProblems } from '../lib/docs/acceptance-captures';
import {
  findIdentifierReferences,
  findNumberedRuleReferences,
  findRepositoryPathReferences,
  holdsIdentifier,
  findRouteHandlerReferences,
  findUnresolvedRulePointers,
  numberedItemsUnder,
  type NumberedRuleSource,
  repositoryPathCandidates,
} from '../lib/docs/reference-rules';
import {
  countMechanisms,
  declaredLintRuleNames,
  declaredSelectorSetNames,
  findEnforcedByProblems,
  findStandardProblems,
  findUnreferencedMechanisms,
  findVirtueAgreementProblems,
  isRuleTest,
  readVirtueBlocks,
  TEST_FILE_PATTERN,
  type MechanismResolver,
} from '../lib/docs/virtue-standards';
import { getTestGroups, listTestFiles } from '../lib/testing/selection/test-groups';
import {
  findSlicesWithoutBrowserProof,
  readGoldenGates,
  readTestTitles,
} from '../lib/docs/slice-browser-proof';
import { repositoryMechanismIndex, tierClaimProblem } from '../lib/testing/runs/incident-mechanisms';
import {
  APPEND_ONLY_LOGS,
  DATED_DOCS,
  DATED_LINES,
  DEAD_CITATIONS,
  LIVING_PLAN_FAMILY,
  NUMBERED_RULE_FIXTURES,
  SHARED_SENTENCES,
  UNMIRRORED_SKILLS,
  wordBudgetOf,
} from '../lib/docs/doc-policy';
import { findIndexCoverageProblems, findIndexStatusProblems } from '../lib/docs/doc-index';
import { readDocStatus, type DocStatus } from '../lib/docs/status-lines';
import { findSkillMirrorProblems, type SkillTree } from '../lib/docs/skill-mirror';
import {
  DELETION_PASS_SINCE,
  DURABLE_HOMES_SINCE,
  deletionPassProblems,
  hasDurableHomes,
} from '../lib/docs/record-sections';
import { findCatalogProblems } from '../lib/docs/flow-catalog';
import { findIncidentTierProblems } from '../lib/docs/incident-tiers';
import { findBrokenLinks } from '../lib/docs/doc-links';
import { lastCommits, reviewStampProblem, uncommittedPaths } from '../lib/docs/review-stamps';
import { decisionGrowthProblem } from '../lib/docs/decision-records';
import { findJudgmentRatchetProblems, parseJudgmentRatchet } from '../lib/docs/judgment-ratchet';
import { enabledRuleNames, lintNameInForce, usedConfigBindings } from '../lib/docs/lint-config';
import { findSharedSentenceProblems, findSharedSentences } from '../lib/docs/one-home';

const repoRoot = resolve(import.meta.dir, '..');
const docsRoot = join(repoRoot, 'docs');
const problems: string[] = [];
function report(area: string, found: readonly string[]): void {
  problems.push(...found.map((problem) => `${area}: ${problem}`));
}
function repoPath(path: string): string {
  return relative(repoRoot, path).split(sep).join('/');
}
function read(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}
function git(args: readonly string[], cwd = repoRoot): { ok: boolean; out: string } {
  const result = Bun.spawnSync(['git', ...args], { cwd });
  return { ok: result.exitCode === 0, out: result.stdout.toString() };
}
/** The output of a Git command that must succeed: a failure would leave a check without its data. */
function gitOut(args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: repoRoot });
  if (result.exitCode !== 0)
    throw new Error(`docs:check: git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString();
}
function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? collectFiles(fullPath) : [fullPath];
  });
}

// The sibling clones sit beside the app. A link into a missing clone is counted once under
// "workspace" instead of failing link by link.
const workspaceRoot = dirname(repoRoot);
const missingSiblings = new Set(
  SIBLING_REPOSITORIES.filter((sibling) => !existsSync(join(workspaceRoot, sibling))),
);
const unreadableSiblings = new Set(
  (process.env.WERKFLOW_UNREADABLE_SIBLINGS ?? '').split(',').filter(Boolean),
);
const uncheckedSiblingLinks = new Map<SiblingRepository, number>();
function pointsIntoMissingSibling(path: string): boolean {
  const sibling = siblingOfWorkspacePath(relative(workspaceRoot, path));
  if (sibling === null || !missingSiblings.has(sibling)) return false;
  uncheckedSiblingLinks.set(sibling, (uncheckedSiblingLinks.get(sibling) ?? 0) + 1);
  return true;
}
const anchorCache = new Map<string, Set<string>>();
function headingAnchors(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const anchors = markdownHeadingAnchors(readFileSync(path, 'utf8'));
  anchorCache.set(path, anchors);
  return anchors;
}

// The docs tree: paths relative to docs/ and their status lines.
const docPaths = collectFiles(docsRoot)
  .filter((file) => file.endsWith('.md'))
  .map((file) => relative(docsRoot, file).split(sep).join('/'));
const docText = new Map(docPaths.map((path) => [path, readFileSync(join(docsRoot, path), 'utf8')]));
function docMarkdown(path: string): string {
  return docText.get(path) ?? '';
}
const statuses = new Map<string, DocStatus | null>();
for (const path of docPaths) {
  const result = readDocStatus(path, docMarkdown(path));
  if ('problem' in result) problems.push(`status: docs/${path} ${result.problem}`);
  statuses.set(path, 'status' in result ? result.status : null);
}
const livingDocs = docPaths
  .filter((path) => statuses.get(path)?.kind === 'living')
  .map((path) => `docs/${path}`);

// Index coverage and the status prefixes of index rows.
const indexContent = docMarkdown('README.md');
report('index', findIndexCoverageProblems(indexContent, docPaths));
report('index', findIndexStatusProblems(indexContent, statuses));

// Relative links and their heading anchors.
for (const path of docPaths) {
  const file = join(docsRoot, path);
  const broken = findBrokenLinks(docMarkdown(path), {
    resolve: (target) => (target === '' ? file : resolve(dirname(file), target)),
    exists: existsSync,
    inMissingSibling: pointsIntoMissingSibling,
    anchors: headingAnchors,
  });
  report(
    'link',
    broken.map((problem) => `docs/${path} → ${problem}`),
  );
}

// The .claude and .agents skill trees.
const claudeSkillsRoot = join(repoRoot, '.claude', 'skills');
const agentsSkillsRoot = join(repoRoot, '.agents', 'skills');
function readSkillTree(root: string): SkillTree {
  return new Map(
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map(({ name: skill }) => [
        skill,
        new Map(
          collectFiles(join(root, skill)).map((file) => [
            relative(join(root, skill), file).split(sep).join('/'),
            new Uint8Array(readFileSync(file)),
          ]),
        ),
      ]),
  );
}
report(
  'skills',
  findSkillMirrorProblems(
    readSkillTree(claudeSkillsRoot),
    readSkillTree(agentsSkillsRoot),
    UNMIRRORED_SKILLS,
  ),
);

// CodeRabbit: agent-facing instructions route local reviews through the repository wrapper. The
// review of record is the app on the pull request (decision 0009), so AGENTS.md need not name it.
for (const path of [
  'AGENTS.md',
  '.claude/skills/coderabbit-review/SKILL.md',
  'docs/technical/coderabbit.md',
]) {
  if (!existsSync(join(repoRoot, path))) {
    problems.push(`coderabbit: expected instruction file ${path} is missing`);
    continue;
  }
  const content = read(path);
  if (path !== 'AGENTS.md' && !content.includes('bun run review'))
    problems.push(`coderabbit: ${path} must route agents through bun run review`);
  for (const violation of findCodeRabbitInstructionViolations(content))
    problems.push(`coderabbit: ${path} contains forbidden ${violation} instructions; use bun run review`);
}
const packageJsonContent = read('package.json');
if (!packageJsonContent.includes('"review": "bun scripts/run-coderabbit-review.ts"'))
  problems.push(
    'coderabbit: package.json must expose bun scripts/run-coderabbit-review.ts as the review script',
  );

// A doc-to-doc reference inside docs/ is a relative link, so the link check above resolves it.
const docPathsByBasename = new Map<string, string[]>();
for (const path of docPaths) {
  const basename = path.split('/').at(-1) ?? path;
  docPathsByBasename.set(basename, [...(docPathsByBasename.get(basename) ?? []), path]);
}
function namesExistingDoc(fromPath: string, reference: string): boolean {
  const cleaned = reference.replace(/^docs\//, '');
  const fromDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  if ([cleaned, join(fromDir, cleaned).split(sep).join('/')].some((candidate) => docText.has(candidate)))
    return true;
  return !cleaned.includes('/') && docPathsByBasename.has(cleaned);
}
for (const path of docPaths) {
  if (APPEND_ONLY_LOGS.includes(`docs/${path}`)) continue;
  for (const { line, reference } of findBacktickedDocPaths(docMarkdown(path), (name) =>
    namesExistingDoc(path, name),
  ))
    problems.push(
      `link-syntax: docs/${path}:${line} references ${reference} in backticks; use a relative markdown link (docs/README.md maintenance rule 3)`,
    );
}

// The roadmap: rows, counter, ready set, record links, browser proof and spec review.
const roadmapContent = docMarkdown('plans/phase-1/roadmap.md');
const roadmap = readRoadmapRows(roadmapContent);
report(
  'roadmap',
  roadmap.problems.map((problem) => `docs/plans/phase-1/roadmap.md ${problem}`),
);
report('roadmap', findRoadmapCounterProblems(roadmapContent, roadmap.rows));
const featureSpecs = docPaths.filter((path) => path.startsWith('features/'));
const roadmapRows = checkRoadmapRows(roadmap.rows, {
  statuses,
  logEntries: readLogEntries(docMarkdown('plans/phase-1/log.md')),
  featureSpecs,
});
report('roadmap', roadmapRows.problems);
const completeSlices = roadmap.rows.filter((row) => row.status === 'complete').map((row) => row.id);
report(
  'roadmap',
  findSlicesWithoutBrowserProof({
    completeSlices,
    gates: readGoldenGates(docMarkdown('plans/phase-1/gates.md')),
    specTitles: new Map(
      ['tests/golden', 'tests/audit', 'tests/canary']
        .flatMap((directory) => listTestFiles(repoRoot, directory, /\.spec\.ts$/))
        .map((file) => [file, readTestTitles(file, read(file))]),
    ),
  }),
);
report(
  'spec-review',
  findStaleSpecReviews(
    roadmapRows.accepted,
    new Map(featureSpecs.map((spec) => [spec, statuses.get(spec)?.date ?? null])),
  ),
);
report(
  'slices',
  findSliceRecordProblems({
    paths: docPaths,
    sliceIds: new Set(roadmap.rows.map((row) => row.id.toUpperCase())),
  }),
);
report(
  'catalog',
  findCatalogProblems(docMarkdown('product/user-flow-catalog.md')).map(
    (problem) => `docs/product/user-flow-catalog.md ${problem}`,
  ),
);

// Incident tiers.
const incidentMechanisms = repositoryMechanismIndex(repoRoot);
report(
  'incident-tier',
  findIncidentTierProblems(docMarkdown('technical/test-incident-log.md'), (line) =>
    tierClaimProblem(line, incidentMechanisms),
  ),
);

// Closed records: the deletion pass of a slice record, the durable homes of a plan record and the banner.
const changedNow = uncommittedPaths(
  gitOut(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'docs']),
);
for (const [path, status] of statuses) {
  if (status?.kind !== 'closed') continue;
  const markdown = docMarkdown(path);
  if (path.startsWith('plans/phase-1/slices/') && status.date >= DELETION_PASS_SINCE)
    report(
      'deletion-pass',
      deletionPassProblems({ markdown, closedOn: status.date }).map((problem) => `docs/${path} ${problem}`),
    );
  if (
    path.startsWith('plans/') &&
    !LIVING_PLAN_FAMILY.includes(`docs/${path}`) &&
    status.date >= DURABLE_HOMES_SINCE &&
    !hasDurableHomes(markdown)
  )
    problems.push(
      `durable-homes: docs/${path} closes without a "## Durable homes" section naming where its lasting facts now live (docs/README.md maintenance rule 6)`,
    );
  if (!hasClosedRecordBanner(markdown))
    problems.push(
      `closed-banner: docs/${path} is closed but line ${CLOSED_RECORD_BANNER_LINE} is not the banner "${CLOSED_RECORD_BANNER}" followed by a blank line`,
    );
}

// Guidance outside docs/ (AGENTS.md and the skills) points only at files that exist.
const guidanceFiles = [
  'AGENTS.md',
  ...[claudeSkillsRoot, agentsSkillsRoot].flatMap((root) =>
    collectFiles(root)
      .filter((file) => file.endsWith('.md'))
      .map(repoPath),
  ),
];
for (const path of guidanceFiles) {
  for (const reference of findDocumentReferences(read(path))) {
    const target =
      reference.kind === 'link'
        ? resolve(dirname(join(repoRoot, path)), reference.target)
        : join(repoRoot, reference.target);
    if (!existsSync(target) && !pointsIntoMissingSibling(target))
      problems.push(`guidance: ${path} references ${reference.target}, which does not exist`);
  }
}

// Dates and word budgets. A living doc states its rules as they are now; dated logs and dated
// research snapshots are exempt, and the roadmap keeps the acceptance date of a complete row.
for (const path of livingDocs) {
  if (DATED_DOCS.includes(path)) continue;
  const markdown = read(path);
  for (const line of findDatedLines(markdown, DATED_LINES[path]))
    problems.push(
      `dated: ${path}:${line} carries a date outside the status line; state the rule as it is now and leave the story to Git, a closed record or a log (docs/README.md, "What a doc may contain")`,
    );
  for (const line of findCommitHashLines(markdown))
    problems.push(
      `dated: ${path}:${line} names a commit hash; Git holds history, a living doc states the rule`,
    );
}
for (const path of [
  ...livingDocs,
  'AGENTS.md',
  ...guidanceFiles.filter((file) => file.startsWith('.claude/')),
]) {
  const budget = wordBudgetOf(path, true);
  const words = countWords(read(path));
  if (budget !== null && words > budget)
    problems.push(`budget: ${path} has ${words} words; it stays at or under ${budget} (decision 0004)`);
}

// Review stamps: a living doc's "last reviewed" date is not older than its last change.
const today = getBusinessTodayIso();
const commitFormat = '--format=%x00%H %as';
const lastChanged = lastCommits(gitOut(['log', '--name-only', commitFormat, '--', 'docs']));
// The commits whose diff of a doc adds or removes its stamp line: they recorded a review.
const lastStamped = lastCommits(
  gitOut(['log', '--name-only', commitFormat, '-G^Status: living — last reviewed', '--', 'docs']),
);
for (const path of livingDocs) {
  const stamp = statuses.get(path.slice('docs/'.length))?.date;
  const committed = lastChanged.get(path);
  if (stamp === undefined) continue;
  const change = changedNow.has(path)
    ? { date: today, uncommitted: true, movedStamp: false }
    : committed === undefined
      ? null
      : {
          date: committed.date,
          uncommitted: false,
          movedStamp: lastStamped.get(path)?.hash === committed.hash,
        };
  const problem = change === null ? null : reviewStampProblem(stamp, change, today);
  if (problem !== null) problems.push(`review-stamp: ${path}: ${problem}`);
}

// Decision records grow only by dated amendment sections: the committed and the published texts
// stay prefixes of the current one.
const publishedRef = git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']).ok
  ? 'origin/main'
  : null;
for (const path of docPaths.filter((doc) => doc.startsWith('decisions/'))) {
  for (const ref of ['HEAD', ...(publishedRef === null ? [] : [publishedRef])]) {
    const earlier = git(['show', `${ref}:docs/${path}`]);
    if (!earlier.ok) continue;
    const problem = decisionGrowthProblem(earlier.out, docMarkdown(path));
    if (problem !== null) problems.push(`decision: docs/${path} against ${ref}: ${problem}`);
  }
}

// The six virtues: owner-doc standards, the "Enforced by" lines, their agreement, mechanism
// coverage and the judgment ratchet.
const lintableFiles = gitOut(['ls-files', '*.ts', '*.tsx', '*.mjs', '*.js', '*.cjs'])
  .split('\n')
  .filter(Boolean);
const eslint = new ESLint({ cwd: repoRoot });
const resolvedConfigs = [];
for (const file of lintableFiles) {
  if (!(await eslint.isPathIgnored(file))) resolvedConfigs.push(await eslint.calculateConfigForFile(file));
}
const enabledLintRules = enabledRuleNames(resolvedConfigs);
const eslintConfigSource = read('eslint.config.mjs');
const configBindings = usedConfigBindings(eslintConfigSource);
function scriptNames(packageJson: unknown): string[] {
  if (typeof packageJson !== 'object' || packageJson === null || !('scripts' in packageJson)) return [];
  const { scripts } = packageJson;
  return typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : [];
}
const packageScripts = new Set(scriptNames(JSON.parse(packageJsonContent)));
const groupIds = getTestGroups(repoRoot).map((group) => group.id);
function mechanismResolver(fromDoc: string): MechanismResolver {
  return {
    lintNameExists: (name) => lintNameInForce(name, enabledLintRules, configBindings),
    pathExists: (path) => existsSync(join(repoRoot, path)),
    groupExists: (id) => {
      const wildcard = id.search(/[*<]/);
      return wildcard === -1
        ? groupIds.includes(id)
        : groupIds.some((groupId) => groupId.startsWith(id.slice(0, wildcard)));
    },
    scriptExists: (name) => packageScripts.has(name),
    linkExists: (target) => existsSync(resolve(dirname(join(repoRoot, fromDoc)), target)),
  };
}
const agentsContent = read('AGENTS.md');
const virtueBlocks = readVirtueBlocks(agentsContent);
const ownerDocs = [...new Set(virtueBlocks.flatMap((block) => block.ownerDocs))];
for (const ownerDoc of ownerDocs) {
  if (!existsSync(join(repoRoot, ownerDoc))) {
    problems.push(`virtue: owner doc ${ownerDoc} is missing (AGENTS.md names it)`);
    continue;
  }
  report(
    'virtue',
    findStandardProblems(read(ownerDoc), mechanismResolver(ownerDoc)).map(
      (problem) => `${ownerDoc} ${problem}`,
    ),
  );
}
for (const reference of findEnforcedByProblems(agentsContent, mechanismResolver('AGENTS.md')))
  problems.push(
    `virtue: AGENTS.md:${reference.line} names \`${reference.token}\`, which ${reference.problem}`,
  );
for (const block of virtueBlocks) {
  const markdown = block.ownerDocs.filter((doc) => existsSync(join(repoRoot, doc))).map(read);
  report('virtue', findVirtueAgreementProblems(block, markdown));
}
const virtueCorpus = [
  agentsContent,
  ...ownerDocs.filter((doc) => existsSync(join(repoRoot, doc))).map(read),
].join('\n');
const eslintRuleFiles = readdirSync(join(repoRoot, 'eslint-rules'))
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => `eslint-rules/${file}`);
const mechanismTests = [
  ...['conventions', 'ui', 'security'].flatMap((folder) =>
    readdirSync(join(repoRoot, 'lib', folder))
      .filter((file) => TEST_FILE_PATTERN.test(file))
      .map((file) => `lib/${folder}/${file}`),
  ),
  ...listTestFiles(repoRoot, 'lib/testing', TEST_FILE_PATTERN).filter((file) => isRuleTest(read(file))),
];
const localLintRules = eslintRuleFiles.flatMap((file) => declaredLintRuleNames(read(file)));
for (const mechanism of findUnreferencedMechanisms(
  [...localLintRules, ...mechanismTests, ...declaredSelectorSetNames(eslintConfigSource)],
  virtueCorpus,
))
  problems.push(
    `virtue: ${mechanism} is named by no owner doc and not by AGENTS.md; add it to the checklist of the virtue it enforces`,
  );
const judgmentCounts = new Map(
  ownerDocs
    .filter((doc) => existsSync(join(repoRoot, doc)))
    .map((doc) => [doc, countMechanisms(read(doc)).judgment]),
);
const ratchetPath = 'lib/docs/judgment-ratchet.json';
const committedRatchet = git(['show', `HEAD:${ratchetPath}`]);
report(
  'virtue',
  findJudgmentRatchetProblems(
    judgmentCounts,
    parseJudgmentRatchet(JSON.parse(read(ratchetPath))),
    committedRatchet.ok ? parseJudgmentRatchet(JSON.parse(committedRatchet.out)) : null,
  ),
);

// Doc citations in code: a docs/...md path (with an optional #anchor) in a comment, lint message
// or thrown string outside docs/ resolves to a document and heading. A listed dead citation that
// no longer fails is stale and fails itself.
const trackedFiles = gitOut(['ls-files', '--cached', '--others', '--exclude-standard'])
  .split('\n')
  .filter((file) => isCitationCheckedFile(file) && existsSync(join(repoRoot, file)));
// The policy lists the dead citations it allows; each entry is checked for staleness below.
const citedFiles = trackedFiles.filter((file) => file !== 'lib/docs/doc-policy.ts');
const usedDeadCitations = new Set<string>();
for (const file of citedFiles) {
  for (const citation of findDocCitations(read(file))) {
    const target = join(repoRoot, citation.path);
    const problem = !existsSync(target)
      ? 'does not exist'
      : citation.anchor !== null && !headingAnchors(target).has(citation.anchor)
        ? `has no heading #${citation.anchor}`
        : null;
    if (problem === null) continue;
    const key = `${file} -> ${citation.path}`;
    if (DEAD_CITATIONS.includes(key)) {
      usedDeadCitations.add(key);
      continue;
    }
    problems.push(
      `citation: ${file}:${citation.line} cites ${citation.path}${citation.anchor ? `#${citation.anchor}` : ''}, which ${problem}; point it at the current owner doc and heading`,
    );
  }
}
for (const key of DEAD_CITATIONS) {
  if (!usedDeadCitations.has(key))
    problems.push(
      `citation: the dead citation "${key}" no longer fails; remove it from decision 0004 and lib/docs/doc-policy.ts`,
    );
}

// Living guidance names things by values that go stale: living docs (not the append-only logs),
// AGENTS.md and the skills. Closed records and decision records are history.
const livingGuidance = [...livingDocs.filter((path) => !APPEND_ONLY_LOGS.includes(path)), ...guidanceFiles];
const routeHandlers = new Set(readdirSync(join(repoRoot, 'app', 'api')));
for (const file of livingGuidance) {
  const text = read(file);
  for (const reference of findRouteHandlerReferences(text)) {
    if (!routeHandlers.has(reference.name))
      problems.push(
        `route-handler: ${file}:${reference.line} names the route handler "${reference.name}", which has no folder under app/api/`,
      );
  }
  for (const reference of findNumberedRuleReferences(text))
    problems.push(
      `numbered-rule: ${file}:${reference.line} cites "${reference.name}"; link the heading that states the rule instead`,
    );
  for (const line of findMismatchedGermanQuotes(text))
    problems.push(
      `german-quote: ${file}:${line} opens a quotation with „ and closes it with " or ”; close it with “`,
    );
  for (const reference of findRepositoryPathReferences(text)) {
    if (!repositoryPathCandidates(reference.name).some((candidate) => existsSync(join(repoRoot, candidate))))
      problems.push(
        `path: ${file}:${reference.line} names ${reference.name}, which does not exist; point it at the current file`,
      );
  }
  // "`Name` in `path`" and "`path` (`Name`)": the named file holds the identifier.
  for (const reference of findIdentifierReferences(text)) {
    const target = repositoryPathCandidates(reference.path)
      .map((candidate) => join(repoRoot, candidate))
      .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
    if (target && !holdsIdentifier(readFileSync(target, 'utf8'), reference.name))
      problems.push(
        `identifier: ${file}:${reference.line} names ${reference.name} in ${reference.path}, which does not hold it; name the current symbol or file`,
      );
  }
}
// A "rule N" pointer in code resolves to a numbered item of the document it names; only the docs
// index and the client freshness contract number their rules. Markdown was read above.
const numberedRuleSources: NumberedRuleSource[] = [
  {
    document: 'docs/technical/realtime-and-caching.md#client-freshness-contract',
    phrase: /freshness contract\s*$/i,
    numbers: numberedItemsUnder(
      docMarkdown('technical/realtime-and-caching.md'),
      'Client freshness contract',
    ),
  },
  {
    document: 'docs/README.md#maintenance-rules',
    phrase: /maintenance\s*$/i,
    numbers: numberedItemsUnder(indexContent, 'Maintenance rules'),
  },
  {
    document: 'an area guide without numbered rules',
    phrase:
      /\b(?:testing|security|quality|code-quality|review|design|ui|performance|realtime|protocol|docs)(?:\.md)?,?\s*$/i,
    numbers: new Set(),
  },
];
for (const file of trackedFiles.filter(
  (path) => !path.endsWith('.md') && !NUMBERED_RULE_FIXTURES.includes(path),
)) {
  for (const reference of findUnresolvedRulePointers(read(file), numberedRuleSources))
    problems.push(
      `numbered-rule: ${file}:${reference.line} cites "${reference.name}"; name the rule or cite its doc heading instead`,
    );
}

// One home per fact: a sentence of twelve or more words stands in one living doc or skill only.
const oneHomeCorpus = [
  ...livingDocs.filter((path) => !APPEND_ONLY_LOGS.includes(path)),
  'AGENTS.md',
  ...guidanceFiles.filter((file) => file.startsWith('.claude/')),
];
report(
  'one-home',
  findSharedSentenceProblems(
    findSharedSentences(oneHomeCorpus.map((path) => ({ path, markdown: read(path) }))),
    SHARED_SENTENCES,
  ),
);

// The workspace: this check reads the sibling clones and never edits them. A problem inside a
// sibling is fixed in the app target or reported to the sibling's owner.
const appAgentsPath = join(repoRoot, 'AGENTS.md');
function isInsideApp(path: string): boolean {
  const fromApp = relative(repoRoot, path);
  return !fromApp.startsWith('..') && !isAbsolute(fromApp);
}
for (const sibling of SIBLING_REPOSITORIES) {
  const siblingRoot = join(workspaceRoot, sibling);
  if (missingSiblings.has(sibling)) {
    const unchecked = `../${sibling} is not present beside werkflow-app, so ${uncheckedSiblingLinks.get(sibling) ?? 0} of the app's links into it and all of its links into the app are unchecked`;
    // CI names a private sibling it has no read token for; it warns there instead of failing.
    if (unreadableSiblings.has(sibling)) console.warn(`docs:check: ${unchecked} (no read access in CI)`);
    else problems.push(`workspace: ${unchecked}; clone it as docs/README.md maintenance rule 7 says`);
    continue;
  }
  const listed = git(['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], siblingRoot);
  if (!listed.ok) {
    problems.push(`workspace: ../${sibling} is not a Git checkout, so its links into the app are unchecked`);
    continue;
  }
  let linksBack = false;
  for (const file of listed.out.split('\n')) {
    const path = join(siblingRoot, file);
    if (file === '' || !existsSync(path)) continue;
    for (const link of findMarkdownFileLinks(readFileSync(path, 'utf8'))) {
      const target = resolve(dirname(path), link.path);
      if (!isInsideApp(target)) continue;
      if (file === 'AGENTS.md' && target === appAgentsPath) linksBack = true;
      const place = `../${sibling}/${file}:${link.line}`;
      if (!existsSync(target)) {
        problems.push(
          `workspace: ${place} links ${link.path}, which does not exist in werkflow-app; restore the target or report the link to the sibling's owner`,
        );
      } else if (
        link.fragment !== null &&
        target.endsWith('.md') &&
        !headingAnchors(target).has(decodeURIComponent(link.fragment))
      ) {
        problems.push(
          `workspace: ${place} links ${link.path}#${link.fragment}, a heading the app doc does not have; restore the heading or report the link to the sibling's owner`,
        );
      }
    }
  }
  if (!linksBack)
    problems.push(`workspace: ../${sibling}/AGENTS.md does not link back to ../werkflow-app/AGENTS.md`);
}
const sharedSkillTable = join(workspaceRoot, 'werkflow-business', 'docs', 'skills.md');
if (!missingSiblings.has('werkflow-business')) {
  if (!existsSync(sharedSkillTable))
    problems.push('workspace: ../werkflow-business/docs/skills.md, the shared skill table, is missing');
  const sharedSkills = existsSync(sharedSkillTable)
    ? readSharedSkills(readFileSync(sharedSkillTable, 'utf8'))
    : [];
  for (const skill of sharedSkills) {
    const folders = skillCopyFolders({
      ...skill,
      consumers: skill.consumers.filter((sibling) => !missingSiblings.has(sibling)),
    });
    const copies = folders.flatMap((folder) => {
      const folderPath = join(workspaceRoot, folder);
      if (!existsSync(folderPath)) {
        problems.push(`workspace: ../${folder} is missing; the shared skill table names it as a copy`);
        return [];
      }
      const files = new Map(
        collectFiles(folderPath).map((file) => [
          relative(folderPath, file).split(sep).join('/'),
          readFileSync(file, 'utf8'),
        ]),
      );
      return [{ folder: `../${folder}`, files }];
    });
    report('workspace', findSkillCopyDifferences(copies));
  }
}

// Rendered acceptance evidence (docs/technical/standards-audit.md): a capture an open plan record
// cites must be the image of a passed test, unchanged since the capture. A closed record is history.
problems.push(
  ...findCaptureCitationProblems(
    repoRoot,
    docPaths
      .filter((path) => path.startsWith('plans/'))
      .map((path) => ({ file: `docs/${path}`, markdown: docMarkdown(path) })),
  ),
);

if (problems.length > 0) {
  console.error(`docs:check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`docs:check passed — ${docPaths.length} docs indexed, linked, and status-labeled.`);
