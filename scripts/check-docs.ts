// Validates the documentation so that drift fails loudly instead of rotting silently.
// Run with: bun run docs:check
//
// This script reads the repository and hands the text to the rules in lib/docs/, which hold the
// logic and its tests. Each problem line starts with the rule's area:
//   index, link, skills, guidance, budget, decision, citation, workspace.
// The numbers and exemptions come from lib/docs/doc-policy.ts.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve, relative, sep } from 'node:path';
import { markdownHeadingAnchors } from '../lib/docs/heading-anchors';
import { countWords, findDocumentReferences } from '../lib/docs/living-doc-rules';
import {
  findMarkdownFileLinks,
  findSkillCopyDifferences,
  readSharedSkills,
  resolveWorkspaceLink,
  SIBLING_REPOSITORIES,
  siblingOfWorkspacePath,
  skillCopyFolders,
  type SiblingRepository,
  workspaceRootOf,
  type WorkspaceLayout,
} from '../lib/docs/workspace-links';
import { findDocCitations, isCitationCheckedFile } from '../lib/docs/code-citations';
import { DEAD_CITATIONS, UNMIRRORED_SKILLS, wordBudgetOf } from '../lib/docs/doc-policy';
import { findIndexCoverageProblems } from '../lib/docs/doc-index';
import { findSkillMirrorProblems, type SkillTree } from '../lib/docs/skill-mirror';
import { findBrokenLinks } from '../lib/docs/doc-links';
import { decisionGrowthProblem } from '../lib/docs/decision-records';

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

// The sibling clones sit beside the main checkout, which a worktree may not. A link into a missing
// clone is counted once under "workspace" instead of failing link by link.
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const workspaceRoot = workspaceRootOf(repoRoot, commonDir.ok ? commonDir.out.trim() : null);
const workspace: WorkspaceLayout = { appRoot: repoRoot, workspaceRoot };
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

// The docs tree: paths relative to docs/.
const docPaths = collectFiles(docsRoot)
  .filter((file) => file.endsWith('.md'))
  .map((file) => relative(docsRoot, file).split(sep).join('/'));
const docText = new Map(docPaths.map((path) => [path, readFileSync(join(docsRoot, path), 'utf8')]));
function docMarkdown(path: string): string {
  return docText.get(path) ?? '';
}

// Index coverage.
report('index', findIndexCoverageProblems(docMarkdown('README.md'), docPaths));

// Relative links and their heading anchors. A decision record keeps its accepted text, so its
// links into the deleted plans tree stay as written; Git holds those plans.
const deletedPlansRoot = join(docsRoot, 'plans') + sep;
for (const path of docPaths) {
  const file = join(docsRoot, path);
  const isDecision = path.startsWith('decisions/');
  const broken = findBrokenLinks(docMarkdown(path), {
    resolve: (target) => {
      if (target === '') return file;
      const resolved = resolveWorkspaceLink(workspace, file, target);
      return isDecision && resolved.startsWith(deletedPlansRoot) ? null : resolved;
    },
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
        ? resolveWorkspaceLink(workspace, join(repoRoot, path), reference.target)
        : join(repoRoot, reference.target);
    if (!existsSync(target) && !pointsIntoMissingSibling(target))
      problems.push(`guidance: ${path} references ${reference.target}, which does not exist`);
  }
}

// Word budgets.
for (const path of [
  ...docPaths.map((doc) => `docs/${doc}`),
  'AGENTS.md',
  ...guidanceFiles.filter((file) => file.startsWith('.claude/')),
]) {
  const budget = wordBudgetOf(path);
  const words = countWords(read(path));
  if (budget !== null && words > budget)
    problems.push(
      `budget: ${path} has ${words} words; it stays at or under ${budget} (lib/docs/doc-policy.ts)`,
    );
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
      `citation: the dead citation "${key}" no longer fails; remove it from lib/docs/doc-policy.ts`,
    );
}

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
    else problems.push(`workspace: ${unchecked}; clone it as docs/README.md#sibling-repositories says`);
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
      const target = resolveWorkspaceLink(workspace, path, link.path);
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

if (problems.length > 0) {
  console.error(`docs:check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`docs:check passed — ${docPaths.length} docs indexed and linked.`);
