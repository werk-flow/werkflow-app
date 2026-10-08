// Validates the docs/ knowledge structure so drift fails loudly instead of rotting silently.
// Run with: bun run docs:check
//
// Checks:
//  1. Index coverage — every docs/**/*.md appears as a link target in docs/README.md
//     (files under docs/plans/phase-1/slices/ are covered by the folder row instead).
//  2. Link resolution — every relative markdown link in docs/**/*.md resolves to an existing file,
//     and a #fragment on a Markdown target resolves to one of its headings (GitHub slug rules).
//  3. Status header — every doc declares a Status line within its first 6 lines.
//  4. Skill mirror sync — every skill present in both .claude/skills/ and .agents/skills/
//     is byte-identical in the two locations (the mirror is maintained by hand).
//  5. CodeRabbit workflow — agent-facing instructions use the repository wrapper and
//     cannot reintroduce installer, raw CLI, or direct WSL command examples.
//  6. Status line position and per-genre shape (line 3, exact format).
//  7. Backtick doc paths inside docs/ must be relative markdown links.
//  8. Index status prefixes ("Closed —"/"Living —") agree with the target doc.
//  9. Roadmap invariants: accepted counter, ready-set recomputation, slice-record linkage and dates.
// 10. User-flow catalog: section order, unique sequential flow IDs, invariant counts.
// 11. One document per slice: per-slice files exist only under plans/phase-1/slices/.
// 12. Incident tiers — every dated incident-log section since decision 0005 names the
//     enforcement tier its prevention landed on (or that no prevention claim follows).
// 13. Deletion pass and review — a slice record closed since the rule carries the section.
// 14. Durable homes — a plan record closed since the rule names where its lasting facts live.
// 15. Guidance references — links and backticked docs paths in AGENTS.md and the skills resolve.
// 16. No dates in living technical docs outside the status line (decision 0004, 2026-10-01).
// 17. Word budgets for living technical docs and AGENTS.md (decision 0004, 2026-10-01).
// 18. Virtue standards — each of the six owner docs carries "How to work", "Checklist", "Never",
//     "Verify your work" and "Examples", every checklist and "Never" item ends with a mechanism tag, and every
//     tagged mechanism, example path and `bun run` script exists (lib/docs/virtue-standards.ts).
// 19. Enforced-by references — backticked paths, lint rules, groups and scripts on the
//     "Enforced by" lines of AGENTS.md resolve.
// 20. Mechanism coverage — every rule of a local ESLint plugin under eslint-rules/, every selector set
//     of eslint.config.mjs, every test under lib/conventions/, lib/ui/ and lib/security/, and every
//     test under lib/testing/ that opens with "// Rule test: " is named by AGENTS.md or an owner doc.
// 21. Doc citations — a docs path cited outside docs/ resolves to a document and heading.
//  9a. Browser proof — every complete roadmap slice has a browser test title with its tag or its gate's tag.
//  9b. Spec review — a feature spec is reviewed on or after the acceptance of every slice that names it as primary.
// 14b. Closed-record banner — every closed record opens with the fixed history banner.
// 22. Route handlers — a backticked route handler in living guidance names a folder under app/api/.
// 23. Numbered rules — no living doc, skill or code file cites a rule by a number that no doc defines.
// 24. Skill paths — a repository path in a skill resolves.
// 25. German quotes — in living guidance a quotation that opens with „ closes with “.
// 26. Workspace — the sibling clones are present, links between them and the app resolve both ways,
//     each sibling's AGENTS.md links back, and shared skill copies equal their canonical copy
//     (lib/docs/workspace-links.ts). A missing clone is one problem, never a pass.
// The checks appear below in the order 1 to 9, 9a, 9b, 11, 10, 12 to 14, 14b, 15 to 26.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, resolve, relative, sep } from 'node:path';
import { findCodeRabbitInstructionViolations } from '../lib/testing/publication/coderabbit-review-command';
import { markdownHeadingAnchors } from '../lib/docs/heading-anchors';
import { findSliceRecordProblems } from '../lib/docs/slice-records';
import {
  countWords,
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
  findStaleSpecReviews,
  logRecordsAcceptance,
  primarySpecsOf,
  readLogEntries,
  readRoadmapRows,
  type AcceptedSlice,
} from '../lib/docs/roadmap-rules';
import {
  CLOSED_RECORD_BANNER,
  CLOSED_RECORD_BANNER_LINE,
  hasClosedRecordBanner,
} from '../lib/docs/closed-records';
import {
  findNumberedRuleReferences,
  findRepositoryPathReferences,
  findRouteHandlerReferences,
  repositoryPathCandidates,
} from '../lib/docs/reference-rules';
import {
  declaredLintRuleNames,
  declaredSelectorSetNames,
  findEnforcedByProblems,
  findStandardProblems,
  findUnreferencedMechanisms,
  isRuleTest,
  TEST_FILE_PATTERN,
  type MechanismResolver,
} from '../lib/docs/virtue-standards';
import { getTestGroups, listTestFiles } from '../lib/testing/selection/test-groups';
import {
  findSlicesWithoutBrowserProof,
  readGoldenGates,
  readTestTitles,
} from '../lib/docs/slice-browser-proof';
import { INCIDENT_TIER_PATTERN } from '../lib/testing/runs/incident-record';

const repoRoot = resolve(import.meta.dir, '..');
const docsRoot = join(repoRoot, 'docs');
// The sibling clones sit beside the app (check 26). A link into a missing clone is counted there once
// instead of failing link by link.
const workspaceRoot = dirname(repoRoot);
const missingSiblings = new Set(
  SIBLING_REPOSITORIES.filter((sibling) => !existsSync(join(workspaceRoot, sibling))),
);
const uncheckedSiblingLinks = new Map<SiblingRepository, number>();
function pointsIntoMissingSibling(path: string): boolean {
  const sibling = siblingOfWorkspacePath(relative(workspaceRoot, path));
  if (sibling === null || !missingSiblings.has(sibling)) return false;
  uncheckedSiblingLinks.set(sibling, (uncheckedSiblingLinks.get(sibling) ?? 0) + 1);
  return true;
}

function collectFiles(dir: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      collected.push(...collectFiles(fullPath));
    } else {
      collected.push(fullPath);
    }
  }
  return collected;
}

const docFiles = collectFiles(docsRoot).filter((file) => file.endsWith('.md'));
const problems: string[] = [];

// 1. Index coverage
const indexContent = readFileSync(join(docsRoot, 'README.md'), 'utf8');
const sliceFolderCovered = indexContent.includes('phase-1/slices');
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join('/');
  if (relPath === 'README.md') continue;
  if (relPath.startsWith('plans/phase-1/slices/')) {
    if (!sliceFolderCovered) {
      problems.push(
        `index: ${relPath} relies on the phase-1/slices folder row, which is missing from docs/README.md`,
      );
    }
    continue;
  }
  if (!indexContent.includes(`(${relPath})`) && !indexContent.includes(`(${relPath}#`)) {
    problems.push(
      `index: ${relPath} is not linked from docs/README.md — add it to the index or retire the file`,
    );
  }
}

// 2. Relative link resolution, including heading anchors: a renamed heading used to break every
//    inbound "#fragment" silently (five such links after the testing guide rewrite of 2026-09-25).
const linkPattern = /\]\(([^)\s]+)\)/g;
const anchorCache = new Map<string, Set<string>>();
function headingAnchors(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const anchors = markdownHeadingAnchors(readFileSync(path, 'utf8'));
  anchorCache.set(path, anchors);
  return anchors;
}
for (const file of docFiles) {
  const content = readFileSync(file, 'utf8');
  const relFile = relative(repoRoot, file).split(sep).join('/');
  for (const match of content.matchAll(linkPattern)) {
    const [, target] = match;
    if (target === undefined || /^(https?:|mailto:)/.test(target)) continue;
    const [pathPart = '', fragment] = target.split('#');
    const targetPath = pathPart === '' ? file : resolve(dirname(file), pathPart);
    if (!existsSync(targetPath)) {
      if (pointsIntoMissingSibling(targetPath)) continue;
      problems.push(`link: ${relFile} → ${target} does not resolve`);
      continue;
    }
    if (
      fragment !== undefined &&
      targetPath.endsWith('.md') &&
      !headingAnchors(targetPath).has(decodeURIComponent(fragment))
    ) {
      problems.push(
        `anchor: ${relFile} → ${target} names no heading of the target; use the heading's slug or drop the fragment`,
      );
    }
  }
}

// 3. Status headers — must exist AND use the documented vocabulary
// (docs/README.md maintenance rule 1): living, closed, complete (slice records),
// accepted (ADRs), or pointer stub.
const statusPattern = /^(>\s*)?(-\s*)?\*{0,2}Status:?\*{0,2}/i;
const statusVocabulary = /(living|closed|complete|accepted|pointer stub)/i;
for (const file of docFiles) {
  const firstLines = readFileSync(file, 'utf8').split('\n').slice(0, 6);
  const statusLine = firstLines.find((line) => statusPattern.test(line));
  const relFile = relative(repoRoot, file).split(sep).join('/');
  if (statusLine === undefined) {
    problems.push(`status: ${relFile} has no Status header in its first 6 lines`);
  } else if (!statusVocabulary.test(statusLine)) {
    problems.push(
      `status: ${relFile} status line uses none of the documented states (living/closed/complete/accepted/pointer stub): "${statusLine.trim()}"`,
    );
  }
}

// 4. Skill mirror sync
// Deliberately unmirrored .claude-only skills must be listed here with a reason,
// otherwise a one-sided skill fails the check in BOTH directions.
const claudeOnlySkillExceptions = new Set([
  'coderabbit-review', // Codex ships its own CodeRabbit skill; mirroring would duplicate it
]);
const claudeSkillsRoot = join(repoRoot, '.claude', 'skills');
const agentsSkillsRoot = join(repoRoot, '.agents', 'skills');
if (existsSync(claudeSkillsRoot) && existsSync(agentsSkillsRoot)) {
  const claudeSkills = new Set(readdirSync(claudeSkillsRoot));
  const agentsSkills = new Set(readdirSync(agentsSkillsRoot));
  for (const skillName of claudeSkills) {
    if (!agentsSkills.has(skillName)) {
      if (!claudeOnlySkillExceptions.has(skillName)) {
        problems.push(
          `skills: ${skillName} exists only in .claude/skills — mirror it or add it to claudeOnlySkillExceptions in scripts/check-docs.ts with a reason`,
        );
      }
      continue;
    }
    const claudeFiles = collectFiles(join(claudeSkillsRoot, skillName));
    for (const claudeFile of claudeFiles) {
      const mirrorFile = join(
        agentsSkillsRoot,
        skillName,
        relative(join(claudeSkillsRoot, skillName), claudeFile),
      );
      if (!existsSync(mirrorFile)) {
        problems.push(
          `skills: ${skillName}/${relative(join(claudeSkillsRoot, skillName), claudeFile)} missing from .agents/skills mirror`,
        );
      } else if (!readFileSync(claudeFile).equals(readFileSync(mirrorFile))) {
        problems.push(
          `skills: ${skillName} drifted between .claude/skills and .agents/skills — re-sync the mirror`,
        );
      }
    }
    for (const agentsFile of collectFiles(join(agentsSkillsRoot, skillName))) {
      const relativePath = relative(join(agentsSkillsRoot, skillName), agentsFile);
      if (!existsSync(join(claudeSkillsRoot, skillName, relativePath))) {
        problems.push(
          `skills: ${skillName}/${relativePath} exists only in .agents/skills; mirror it in .claude/skills`,
        );
      }
    }
  }
  for (const skillName of agentsSkills) {
    if (!claudeSkills.has(skillName)) {
      problems.push(
        `skills: ${skillName} exists only in .agents/skills — mirror it or record the exception in docs/README.md`,
      );
    }
  }
}

// 5. CodeRabbit workflow
const codeRabbitInstructionFiles = [
  join(repoRoot, 'AGENTS.md'),
  join(repoRoot, '.claude', 'skills', 'coderabbit-review', 'SKILL.md'),
  join(docsRoot, 'technical', 'coderabbit.md'),
];
for (const file of codeRabbitInstructionFiles) {
  if (!existsSync(file)) {
    const relFile = relative(repoRoot, file).split(sep).join('/');
    problems.push(`coderabbit: expected instruction file ${relFile} is missing`);
    continue;
  }
  const content = readFileSync(file, 'utf8');
  const relFile = relative(repoRoot, file).split(sep).join('/');
  if (!content.includes('bun run review')) {
    problems.push(`coderabbit: ${relFile} must route agents through bun run review`);
  }
  for (const violation of findCodeRabbitInstructionViolations(content)) {
    problems.push(`coderabbit: ${relFile} contains forbidden ${violation} instructions; use bun run review`);
  }
}

const packageJsonContent = readFileSync(join(repoRoot, 'package.json'), 'utf8');
if (!packageJsonContent.includes('"review": "bun scripts/run-coderabbit-review.ts"')) {
  problems.push(
    'coderabbit: package.json must expose bun scripts/run-coderabbit-review.ts as the review script',
  );
}
if (!existsSync(join(repoRoot, 'scripts', 'run-coderabbit-review.ts'))) {
  problems.push('coderabbit: scripts/run-coderabbit-review.ts is missing');
}

// 6. Status line position and shape (docs/README.md maintenance rule 1, tightened 2026-09-03
//    after the post-Wave-2 docs audit found seven incompatible slice-record formats, a status
//    line hidden on line 5, and index rows disagreeing with their targets).
//    Line 1 is the H1, line 2 is blank, line 3 is the status line in the genre's exact shape.
const livingStatusPattern = /^Status: living — last reviewed \d{4}-\d{2}-\d{2}(; .+)?$/;
const closedStatusPattern = /^Status: closed \(\d{4}-\d{2}-\d{2}\) — .+$/;
const decisionStatusPattern = /^- \*\*Status:\*\* accepted \(\d{4}-\d{2}-\d{2}\)( — .+)?$/;

function readDocStatus(
  file: string,
): { kind: 'living' | 'closed' | 'accepted' | 'pointer stub'; date: string | null } | null {
  const lines = readFileSync(file, 'utf8').split('\n');
  const relFile = relative(repoRoot, file).split(sep).join('/');
  if (!lines[0]?.startsWith('# ')) {
    problems.push(`status: ${relFile} must start with an H1 on line 1`);
    return null;
  }
  if ((lines[1] ?? '').trim() !== '') {
    problems.push(`status: ${relFile} needs one blank line between the H1 and the status line`);
    return null;
  }
  const statusLine = (lines[2] ?? '').trimEnd();
  const isDecision = relFile.startsWith('docs/decisions/');
  const pattern = isDecision
    ? decisionStatusPattern
    : statusLine.startsWith('Status: closed')
      ? closedStatusPattern
      : livingStatusPattern;
  if (!pattern.test(statusLine)) {
    problems.push(
      `status: ${relFile} line 3 must match ${pattern} (docs/README.md maintenance rule 1); found: "${statusLine}"`,
    );
    return null;
  }
  const date = statusLine.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  if (isDecision) return { kind: 'accepted', date };
  return { kind: statusLine.startsWith('Status: closed') ? 'closed' : 'living', date };
}

const docStatuses = new Map<string, ReturnType<typeof readDocStatus>>();
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join('/');
  docStatuses.set(relPath, readDocStatus(file));
}

// 7. Backtick doc paths inside docs/ (maintenance rule 3): a doc-to-doc reference must be a
//    relative markdown link so the resolver above can check it. Append-only logs are exempt
//    because their historical entries are immutable.
const backtickDocPathExemptFiles = new Set([
  'plans/phase-1/log.md',
  'plans/phase-1/audits/golden-gate-log.md',
  'technical/test-incident-log.md',
]);
// Any backticked Markdown path, not only docs/- or ../-prefixed ones (Step 3, 2026-09-13):
// bare sibling paths such as `phase-1/protocol.md` escaped the earlier prefix-only pattern.
// AGENTS.md, CLAUDE.md and skill/memory files are code-facing names, not doc links.
const backtickDocPathPattern = /`((?:docs\/|\.\.\/)?[A-Za-z0-9_-][A-Za-z0-9_./-]*\.md)`/g;
// A backticked name counts only when it names a real document under docs/; artifact names
// such as `error-context.md` and code-facing files (AGENTS.md, SKILL.md) are not doc links.
const docPathsByBasename = new Map<string, string[]>();
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join('/');
  const basename = relPath.split('/').pop()!;
  docPathsByBasename.set(basename, [...(docPathsByBasename.get(basename) ?? []), relPath]);
}
function namesExistingDoc(fromRelPath: string, reference: string): boolean {
  const cleaned = reference.replace(/^docs\//, '');
  const fromDir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : '';
  const candidates = [cleaned, join(fromDir, cleaned).split(sep).join('/')];
  if (candidates.some((candidate) => existsSync(join(docsRoot, candidate)))) return true;
  return !cleaned.includes('/') && docPathsByBasename.has(cleaned);
}
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join('/');
  if (relPath === 'README.md' || backtickDocPathExemptFiles.has(relPath)) continue;
  let insideFence = false;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('```')) insideFence = !insideFence;
    if (insideFence || line.trimStart().startsWith('>')) return;
    // Link text may legitimately carry a backticked file name: [`x.md`](x.md).
    const withoutLinks = line.replace(/\[[^\]]*\]\([^)]*\)/g, '');
    for (const match of withoutLinks.matchAll(backtickDocPathPattern)) {
      const reference = match[1];
      if (reference === undefined || !namesExistingDoc(relPath, reference)) continue;
      problems.push(
        `link-syntax: docs/${relPath}:${index + 1} references ${match[1]} in backticks; use a relative markdown link (docs/README.md maintenance rule 3)`,
      );
    }
  });
}

// 8. Index status prefixes agree with the target doc (rows may say "Closed —" or "Living —";
//    "Complete —" and "Accepted —" are not index vocabulary).
const indexRowPattern = /^\| \[[^\]]+\]\(([^)]+)\)\s*\| (Closed|Living|Complete|Accepted) — /gm;
for (const match of indexContent.matchAll(indexRowPattern)) {
  const [, target, prefix] = match;
  if (target === undefined || prefix === undefined) continue;
  const status = docStatuses.get(target);
  if (prefix === 'Complete' || prefix === 'Accepted') {
    problems.push(
      `index: row for ${target} uses "${prefix} —"; index rows say "Closed —" or "Living —" only`,
    );
    continue;
  }
  if (status && status.kind !== prefix.toLowerCase()) {
    problems.push(
      `index: row for ${target} says "${prefix}" but the doc's status line says "${status.kind}"`,
    );
  }
}

// 9. Roadmap invariants (docs/plans/phase-1/protocol.md status model): the accepted counter
//    equals the number of `complete` rows, and the ready set is recomputed (a `planned` slice has
//    an unaccepted prerequisite; a slice whose prerequisites are all complete is not `planned`).
//    Every complete row links its slice record, and the record's closed date matches the row.
const roadmapPath = join(docsRoot, 'plans', 'phase-1', 'roadmap.md');
const roadmapContent = readFileSync(roadmapPath, 'utf8');
const roadmapIndex = readRoadmapRows(roadmapContent);
problems.push(...roadmapIndex.problems.map((problem) => `roadmap: docs/plans/phase-1/roadmap.md ${problem}`));
const sliceRows = new Map(roadmapIndex.rows.map((row) => [row.id, row]));
const logEntries = readLogEntries(readFileSync(join(docsRoot, 'plans', 'phase-1', 'log.md'), 'utf8'));
const featureSpecs = [...docStatuses.keys()].filter((path) => path.startsWith('features/'));
const acceptedSlices: AcceptedSlice[] = [];
const completeCount = [...sliceRows.values()].filter((row) => row.status === 'complete').length;
const counterMatch = roadmapContent.match(/\*\*Formally accepted roadmap slices:\*\* (\d+) of (\d+)/);
if (!counterMatch) {
  problems.push('roadmap: the accepted-slices counter line is missing from docs/plans/phase-1/roadmap.md');
} else {
  if (Number(counterMatch[1]) !== completeCount) {
    problems.push(
      `roadmap: counter says ${counterMatch[1]} accepted but the slice index has ${completeCount} complete rows`,
    );
  }
  if (Number(counterMatch[2]) !== sliceRows.size) {
    problems.push(
      `roadmap: counter says ${counterMatch[2]} slices but the slice index has ${sliceRows.size} rows`,
    );
  }
}
for (const [id, row] of sliceRows) {
  const allDependenciesComplete = row.dependencies.every(
    (dependency) => sliceRows.get(dependency)?.status === 'complete',
  );
  if (row.status === 'planned' && allDependenciesComplete) {
    problems.push(
      `roadmap: ${id} is planned but every direct prerequisite is complete; recompute the ready set (protocol.md status model)`,
    );
  }
  if (row.status === 'ready' && !allDependenciesComplete) {
    problems.push(`roadmap: ${id} is ready but a direct prerequisite is not complete`);
  }
  if (row.status !== 'complete') continue;
  const recordPath = row.exitEvidence.match(/\]\((slices\/[a-z0-9-]+\.md)\)/)?.[1];
  if (!recordPath) {
    problems.push(`roadmap: complete row ${id} does not link its slice record under slices/`);
    continue;
  }
  if (!recordPath.startsWith(`slices/${id.toLowerCase()}-`)) {
    problems.push(`roadmap: ${id} must link its own slice record; found ${recordPath}`);
  }
  const recordStatus = docStatuses.get(`plans/phase-1/${recordPath}`);
  const rowDate = row.exitEvidence.match(/Accepted `?complete`? (\d{4}-\d{2}-\d{2})/)?.[1];
  if (recordStatus?.kind !== 'closed') {
    problems.push(`roadmap: complete row ${id} links ${recordPath}, whose status line is not closed`);
  } else if (rowDate && recordStatus.date !== rowDate) {
    problems.push(
      `roadmap: ${id} row says accepted ${rowDate} but ${recordPath} is closed (${recordStatus.date})`,
    );
  }
  if (!logRecordsAcceptance(logEntries, id, recordPath)) {
    problems.push(
      `roadmap: ${id} is complete but docs/plans/phase-1/log.md has no entry that links ${recordPath} or says "${id}" was accepted complete (protocol.md, update protocol)`,
    );
  }
  const primarySpecs = primarySpecsOf(row.specs, featureSpecs);
  if (primarySpecs === null) {
    problems.push(
      `roadmap: ${id} names "${row.specs.split(';')[0]?.trim()}" as its primary spec, which maps to no feature spec; name the spec or extend PRIMARY_SPEC_NAMES in lib/docs/roadmap-rules.ts`,
    );
  } else if (recordStatus?.date) {
    acceptedSlices.push({ id, acceptedOn: recordStatus.date, primarySpecs });
  }
}

// 9a. Every complete slice has a browser proof of its own outcome: a title tag or its gate's tag
//     (lib/docs/slice-browser-proof.ts), read from the spec sources without running Playwright.
problems.push(
  ...findSlicesWithoutBrowserProof({
    completeSlices: [...sliceRows.values()].filter((row) => row.status === 'complete').map((row) => row.id),
    gates: readGoldenGates(readFileSync(join(docsRoot, 'plans', 'phase-1', 'gates.md'), 'utf8')),
    specTitles: new Map(
      ['tests/golden', 'tests/audit', 'tests/canary']
        .flatMap((directory) => listTestFiles(repoRoot, directory, /\.spec\.ts$/))
        .map((file) => [file, readTestTitles(file, readFileSync(join(repoRoot, file), 'utf8'))]),
    ),
  }).map((problem) => `roadmap: ${problem}`),
);

// 9b. A spec that an accepted slice names as primary was reviewed on or after the acceptance:
//     the slice changed the product, so its Current Product Baseline was re-read then.
//     The review date lives only in the spec's status line (maintenance rule 1).
problems.push(
  ...findStaleSpecReviews(
    acceptedSlices,
    new Map(featureSpecs.map((spec) => [spec, docStatuses.get(spec)?.date ?? null])),
  ).map((problem) => `spec-review: ${problem}`),
);

// 11. One document per slice (protocol.md "Before Starting A Slice" step 7, decided 2026-09-03 after
//     eight slices had grown a second "implementation plan" file that overlapped their record):
//     a per-slice file (named p1-XX-*) may exist only under plans/phase-1/slices/, and nothing
//     there is named an implementation plan. Cross-slice plans such as the Inventory V1 plan are unaffected.
problems.push(
  ...findSliceRecordProblems({
    paths: docFiles.map((file) => relative(docsRoot, file).split(sep).join('/')),
    sliceIds: new Set([...sliceRows.keys()].map((id) => id.toUpperCase())),
  }).map((problem) => `slices: ${problem}`),
);

// 10. User-flow catalog: slice sections in ID order, flow IDs unique and sequential per slice,
//     and the acceptance-invariant count equal to the section's flow count.
const catalogContent = readFileSync(join(docsRoot, 'product', 'user-flow-catalog.md'), 'utf8');
const catalogSections = [
  ...catalogContent.matchAll(/^### `(P1-\d{2}a?)`[^\n]*\n([\s\S]*?)(?=^### |\n## |$(?![\s\S]))/gm),
];
let previousSliceKey = '';
const seenFlowIds = new Set<string>();
for (const [, sliceId, body] of catalogSections) {
  if (sliceId === undefined || body === undefined) continue;
  const sliceKey = sliceId.padEnd(6, ' ');
  if (sliceKey < previousSliceKey) {
    problems.push(`catalog: section ${sliceId} is out of ID order in docs/product/user-flow-catalog.md`);
  }
  previousSliceKey = sliceKey;
  const definedFlowIds = [...body.matchAll(new RegExp(`^- \`(${sliceId}-F\\d{2,3})\``, 'gm'))].flatMap(
    (entry) => entry[1] ?? [],
  );
  definedFlowIds.forEach((flowId, index) => {
    if (seenFlowIds.has(flowId)) problems.push(`catalog: flow ID ${flowId} is defined twice`);
    seenFlowIds.add(flowId);
    const expected = `${sliceId}-F${String(index + 1).padStart(2, '0')}`;
    if (flowId !== expected)
      problems.push(`catalog: ${sliceId} flow IDs are not sequential; expected ${expected}, found ${flowId}`);
  });
  const invariant = body.match(/\*\*Acceptance invariant:\*\* `(\d+)\/(\d+) mapped/);
  if (invariant && Number(invariant[1]) !== definedFlowIds.length) {
    problems.push(
      `catalog: ${sliceId} invariant says ${invariant[1]} flows but the section defines ${definedFlowIds.length}`,
    );
  }
}

// 12. Incident tiers (decision 0005; mechanized in pre-Wave-3 step 1, 2026-09-14, after the Step 3
//     campaign wrote entries whose prevention named no tier): every dated section of the incident
//     log from the decision's adoption date names Tier 1 or Tier 2, names Tier 3 with a reason in the
//     same sentence, or states that no prevention claim follows. Sections before that date are history.
const incidentLogRelativePath = 'technical/test-incident-log.md';
const incidentTierSince = '2026-08-27';
for (const section of readFileSync(join(docsRoot, incidentLogRelativePath), 'utf8').split(/^(?=#{2,3} )/m)) {
  const heading = section.split('\n')[0] ?? '';
  const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!heading.startsWith('#') || !date || date < incidentTierSince) continue;
  if (INCIDENT_TIER_PATTERN.test(section)) continue;
  problems.push(
    `incident-tier: docs/${incidentLogRelativePath} "${heading.replace(/^#+ /, '')}" names no enforcement tier; end the entry with Tier 1 or Tier 2, "Tier 3: <why no mechanism reaches it>" or "no prevention claim" (decision 0005)`,
  );
}

// 13. Deletion pass and independent review (docs/technical/code-quality.md, first adopted
//     pre-Wave-3 step 2, 2026-09-14): a slice record closed from 2026-09-15 on carries the section
//     with the diff size before and after the pass (two `git diff --shortstat` lines) and the
//     `bun run review` command with its finding dispositions, so a slice cannot close without both.
const deletionPassSince = '2026-09-15';
for (const [file, status] of docStatuses) {
  if (
    !file.startsWith('plans/phase-1/slices/') ||
    status?.kind !== 'closed' ||
    !status.date ||
    status.date < deletionPassSince
  )
    continue;
  const section = readFileSync(join(docsRoot, file), 'utf8').match(
    /^## Deletion pass and review\n([\s\S]*?)(?=^## |$(?![\s\S]))/im,
  )?.[1];
  if (!section) {
    problems.push(
      `deletion-pass: docs/${file} closes without a "## Deletion Pass And Review" section (docs/technical/code-quality.md, Deletion pass and independent review)`,
    );
    continue;
  }
  if ((section.match(/\d+ files? changed/g) ?? []).length < 2) {
    problems.push(
      `deletion-pass: docs/${file} must record the git diff --shortstat line before and after the deletion pass`,
    );
  }
  if (!/bun run review\b/.test(section)) {
    problems.push(
      `deletion-pass: docs/${file} must record the bun run review command it ran and the disposition of every finding`,
    );
  }
}

// 14. Single-use plan records are history only (docs/README.md maintenance rule 6, owner rule of
//     2026-09-17): a slice record, hardening, consolidation, audit or pre-wave record that closes from
//     2026-09-17 on must carry a "## Durable homes" section naming the living doc that now states
//     every fact a later agent needs, because nobody reopens a closed record unprompted. The living
//     roadmap family (roadmap, protocol, gates, coverage, log) is exempt.
const durableHomesSince = '2026-09-17';
const livingRoadmapFamily = new Set([
  'plans/phase-1/roadmap.md',
  'plans/phase-1/protocol.md',
  'plans/phase-1/gates.md',
  'plans/phase-1/coverage.md',
  'plans/phase-1/log.md',
]);
for (const [file, status] of docStatuses) {
  if (
    !file.startsWith('plans/') ||
    livingRoadmapFamily.has(file) ||
    status?.kind !== 'closed' ||
    !status.date ||
    status.date < durableHomesSince
  )
    continue;
  const section = readFileSync(join(docsRoot, file), 'utf8').match(
    /^## Durable homes\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/im,
  )?.[1];
  if (!section || section.trim().length === 0) {
    problems.push(
      `durable-homes: docs/${file} closes without a "## Durable homes" section naming where its lasting facts now live (docs/README.md maintenance rule 6)`,
    );
  }
}

// 14b. A closed record keeps its plan's instructions as history; its fixed banner tells an agent
//     not to carry them out (lib/docs/closed-records.ts says why a sentence pattern cannot).
for (const [file, status] of docStatuses) {
  if (status?.kind !== 'closed' || hasClosedRecordBanner(readFileSync(join(docsRoot, file), 'utf8')))
    continue;
  problems.push(
    `closed-banner: docs/${file} is closed but line ${CLOSED_RECORD_BANNER_LINE} is not the banner "${CLOSED_RECORD_BANNER}" followed by a blank line`,
  );
}

// 15. Guidance outside docs/ (AGENTS.md and the skills) may only point at files that exist:
//     checks 2 and 7 read docs/ alone, so a renamed doc used to leave these pointers dangling.
const guidanceFiles = [join(repoRoot, 'AGENTS.md')];
for (const skillsRoot of [claudeSkillsRoot, agentsSkillsRoot]) {
  if (existsSync(skillsRoot))
    guidanceFiles.push(...collectFiles(skillsRoot).filter((file) => file.endsWith('.md')));
}
for (const file of guidanceFiles) {
  const relFile = relative(repoRoot, file).split(sep).join('/');
  for (const reference of findDocumentReferences(readFileSync(file, 'utf8'))) {
    const resolved =
      reference.kind === 'link' ? resolve(dirname(file), reference.target) : join(repoRoot, reference.target);
    if (!existsSync(resolved) && !pointsIntoMissingSibling(resolved))
      problems.push(`guidance: ${relFile} references ${reference.target}, which does not exist`);
  }
}

// 16 and 17. A living technical doc states rules as they are now (decision 0004, amendment
//     2026-10-01): no date outside its status line and no more words than its budget. Closed docs
//     are history and exempt. The incident log is a dated log by purpose and exempt from both.
const datedLivingDocAllowlist = new Set(['technical/test-incident-log.md']);
const LIVING_TECHNICAL_DOC_WORD_BUDGET = 4000;
const AGENTS_WORD_BUDGET = 2800;
for (const [file, status] of docStatuses) {
  if (!file.startsWith('technical/') || status?.kind !== 'living' || datedLivingDocAllowlist.has(file))
    continue;
  const content = readFileSync(join(docsRoot, file), 'utf8');
  for (const lineNumber of findDatedLines(content)) {
    problems.push(
      `dated: docs/${file}:${lineNumber} carries a date outside the status line; state the rule as it is now and move the story to a closed record (docs/README.md, "What a doc may contain")`,
    );
  }
  const words = countWords(content);
  if (words > LIVING_TECHNICAL_DOC_WORD_BUDGET) {
    problems.push(
      `budget: docs/${file} has ${words} words; a living technical doc stays at or under ${LIVING_TECHNICAL_DOC_WORD_BUDGET} (decision 0004)`,
    );
  }
}
const agentsWords = countWords(readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8'));
if (agentsWords > AGENTS_WORD_BUDGET) {
  problems.push(
    `budget: AGENTS.md has ${agentsWords} words; it stays at or under ${AGENTS_WORD_BUDGET} (decision 0004)`,
  );
}

// 18 to 20. The six virtues (AGENTS.md): one owner doc per virtue carries the same five sections,
//     every mechanism a doc names exists, and every custom lint rule and convention test is named
//     somewhere an agent reads, so a new mechanism cannot land without telling agents.
const virtueOwnerDocs = [
  '.claude/skills/werkflow-design/SKILL.md',
  'docs/technical/realtime-and-caching.md',
  'docs/technical/security.md',
  'docs/technical/code-quality.md',
  'docs/technical/testing.md',
  'docs/README.md',
];
const eslintRuleFiles = readdirSync(join(repoRoot, 'eslint-rules'))
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => join(repoRoot, 'eslint-rules', file));
const lintCorpus = [join(repoRoot, 'eslint.config.mjs'), ...eslintRuleFiles]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
// Rules that the shared typescript-eslint preset enables, which eslint.config.mjs imports through nextTs.
const presetRulesPath = join(
  repoRoot,
  'node_modules/@typescript-eslint/eslint-plugin/dist/configs/eslintrc/recommended.js',
);
const presetRules = existsSync(presetRulesPath) ? readFileSync(presetRulesPath, 'utf8') : '';
const packageScripts = new Set(
  Object.keys((JSON.parse(packageJsonContent) as { scripts?: Record<string, string> }).scripts ?? {}),
);
const groupIds = getTestGroups(repoRoot).map((group) => group.id);
const mechanismResolver: MechanismResolver = {
  lintNameExists: (name) =>
    lintCorpus.includes(name) || (name.startsWith('@typescript-eslint/') && presetRules.includes(name)),
  pathExists: (path) => existsSync(join(repoRoot, path)),
  groupExists: (id) => {
    const wildcard = id.search(/[*<]/);
    return wildcard === -1
      ? groupIds.includes(id)
      : groupIds.some((groupId) => groupId.startsWith(id.slice(0, wildcard)));
  },
  scriptExists: (name) => packageScripts.has(name),
};
for (const ownerDoc of virtueOwnerDocs) {
  const path = join(repoRoot, ownerDoc);
  if (!existsSync(path)) {
    problems.push(`virtue: owner doc ${ownerDoc} is missing (AGENTS.md names it)`);
    continue;
  }
  for (const problem of findStandardProblems(readFileSync(path, 'utf8'), mechanismResolver)) {
    problems.push(`virtue: ${ownerDoc} ${problem}`);
  }
}
const agentsContent = readFileSync(join(repoRoot, 'AGENTS.md'), 'utf8');
for (const reference of findEnforcedByProblems(agentsContent, mechanismResolver)) {
  problems.push(
    `virtue: AGENTS.md:${reference.line} names \`${reference.token}\`, which ${reference.problem}`,
  );
}
const virtueCorpus = [
  agentsContent,
  ...virtueOwnerDocs
    .map((doc) => join(repoRoot, doc))
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, 'utf8')),
].join('\n');
const mechanismTests = [
  ...['conventions', 'ui', 'security'].flatMap((folder) =>
    readdirSync(join(repoRoot, 'lib', folder))
      .filter((file) => TEST_FILE_PATTERN.test(file))
      .map((file) => `lib/${folder}/${file}`),
  ),
  ...listTestFiles(repoRoot, 'lib/testing', TEST_FILE_PATTERN).filter((file) =>
    isRuleTest(readFileSync(join(repoRoot, file), 'utf8')),
  ),
];
const localLintRules = eslintRuleFiles.flatMap((file) => declaredLintRuleNames(readFileSync(file, 'utf8')));
const selectorSets = declaredSelectorSetNames(readFileSync(join(repoRoot, 'eslint.config.mjs'), 'utf8'));
for (const mechanism of findUnreferencedMechanisms(
  [...localLintRules, ...mechanismTests, ...selectorSets],
  virtueCorpus,
)) {
  problems.push(
    `virtue: ${mechanism} is named by no owner doc and not by AGENTS.md; add it to the checklist of the virtue it enforces`,
  );
}

// 21. Doc citations in code: a `docs/...md` path (with an optional #anchor) in a comment, lint message
//     or thrown string outside docs/ resolves to a document and, when it names one, a heading. The
//     allowlist names a file and the path it may cite with a reason; an entry that no longer fails is
//     stale and fails itself.
const DEAD_CITATION_ALLOWLIST: Readonly<Record<string, string>> = {
  'lib/testing/evidence/build-identity.test.ts -> docs/note.md':
    'a fixture file name inside a test, not a citation',
  'lib/testing/evidence/candidate-identity.test.ts -> docs/testing.md':
    'a fixture file name inside a test, not a citation',
  'lib/testing/selection/coverage-map.test.ts -> docs/review.md':
    'a fixture file name inside a test, not a citation',
};
const trackedFiles = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: repoRoot,
})
  .stdout.toString()
  .split('\n')
  // This script names the allowed dead paths above; each entry is checked for staleness below instead.
  .filter(
    (file) =>
      isCitationCheckedFile(file) && file !== 'scripts/check-docs.ts' && existsSync(join(repoRoot, file)),
  );
const usedCitationExceptions = new Set<string>();
for (const file of trackedFiles) {
  for (const citation of findDocCitations(readFileSync(join(repoRoot, file), 'utf8'))) {
    const target = join(repoRoot, citation.path);
    const problem = !existsSync(target)
      ? 'does not exist'
      : citation.anchor !== null && !headingAnchors(target).has(citation.anchor)
        ? `has no heading #${citation.anchor}`
        : null;
    if (problem === null) continue;
    const key = `${file} -> ${citation.path}`;
    if (key in DEAD_CITATION_ALLOWLIST) {
      usedCitationExceptions.add(key);
      continue;
    }
    problems.push(
      `citation: ${file}:${citation.line} cites ${citation.path}${citation.anchor ? `#${citation.anchor}` : ''}, which ${problem}; point it at the current owner doc and heading`,
    );
  }
}
for (const key of Object.keys(DEAD_CITATION_ALLOWLIST)) {
  if (!usedCitationExceptions.has(key))
    problems.push(`citation: the allowlist entry "${key}" no longer matches a dead citation; remove it`);
}

// 22 to 24. Living guidance names things by values that go stale. Living docs (not the append-only
//     logs), AGENTS.md and the skills are checked; closed records and decision records are history.
const appendOnlyLogs = new Set([...backtickDocPathExemptFiles]);
const livingGuidance = [
  ...[...docStatuses]
    .filter(([file, status]) => status?.kind === 'living' && !appendOnlyLogs.has(file))
    .map(([file]) => `docs/${file}`),
  ...guidanceFiles.map((file) => relative(repoRoot, file).split(sep).join('/')),
];
const routeHandlers = new Set(readdirSync(join(repoRoot, 'app', 'api')));
for (const file of livingGuidance) {
  const text = readFileSync(join(repoRoot, file), 'utf8');
  // 22. A backticked route handler names a folder under app/api/.
  for (const reference of findRouteHandlerReferences(text)) {
    if (!routeHandlers.has(reference.name))
      problems.push(
        `route-handler: ${file}:${reference.line} names the route handler "${reference.name}", which has no folder under app/api/`,
      );
  }
  // 23. Rules are named by heading, not by a number that no doc defines (only the index numbers its rules).
  for (const reference of findNumberedRuleReferences(text)) {
    problems.push(
      `numbered-rule: ${file}:${reference.line} cites "${reference.name}"; link the heading that states the rule instead`,
    );
  }
  // 25. German quotation marks pair as „ and “, as lib/conventions/german-copy.test.ts requires of product copy.
  for (const line of findMismatchedGermanQuotes(text)) {
    problems.push(
      `german-quote: ${file}:${line} opens a quotation with „ and closes it with " or ”; close it with “`,
    );
  }
}
// The rule's own module and test spell the phrase as fixtures; Markdown outside docs/ was read above.
const numberedRuleFixtures = new Set(['lib/docs/reference-rules.ts', 'lib/docs/reference-rules.test.ts']);
for (const file of trackedFiles.filter((path) => !path.endsWith('.md') && !numberedRuleFixtures.has(path))) {
  for (const reference of findNumberedRuleReferences(readFileSync(join(repoRoot, file), 'utf8'))) {
    problems.push(
      `numbered-rule: ${file}:${reference.line} cites "${reference.name}"; name the rule or cite its doc heading instead`,
    );
  }
}
// 24. A repository path in a skill resolves, so a moved spec or support module cannot leave a dead pointer.
for (const file of guidanceFiles.filter(
  (path) => path.startsWith(claudeSkillsRoot) || path.startsWith(agentsSkillsRoot),
)) {
  const relFile = relative(repoRoot, file).split(sep).join('/');
  for (const reference of findRepositoryPathReferences(readFileSync(file, 'utf8'))) {
    if (!repositoryPathCandidates(reference.name).some((candidate) => existsSync(join(repoRoot, candidate))))
      problems.push(
        `skill-path: ${relFile}:${reference.line} names ${reference.name}, which does not exist; point it at the current file`,
      );
  }
}

// 26. The workspace (lib/docs/workspace-links.ts): this check reads the sibling clones and never edits
//     them. A problem inside a sibling is fixed in the app target or reported to the sibling's owner.
const appAgentsPath = join(repoRoot, 'AGENTS.md');
function isInsideApp(path: string): boolean {
  const fromApp = relative(repoRoot, path);
  return !fromApp.startsWith('..') && !isAbsolute(fromApp);
}
for (const sibling of SIBLING_REPOSITORIES) {
  const siblingRoot = join(workspaceRoot, sibling);
  if (missingSiblings.has(sibling)) {
    problems.push(
      `workspace: ../${sibling} is not present beside werkflow-app, so ${uncheckedSiblingLinks.get(sibling) ?? 0} of the app's links into it and all of its links into the app are unchecked; clone it as docs/README.md maintenance rule 7 says`,
    );
    continue;
  }
  const listed = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '*.md'], {
    cwd: siblingRoot,
  });
  if (listed.exitCode !== 0) {
    problems.push(`workspace: ../${sibling} is not a Git checkout, so its links into the app are unchecked`);
    continue;
  }
  let linksBack = false;
  for (const file of listed.stdout.toString().split('\n')) {
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
  if (!existsSync(sharedSkillTable)) {
    problems.push('workspace: ../werkflow-business/docs/skills.md, the shared skill table, is missing');
  }
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
    problems.push(...findSkillCopyDifferences(copies).map((difference) => `workspace: ${difference}`));
  }
}

if (problems.length > 0) {
  console.error(`docs:check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`docs:check passed — ${docFiles.length} docs indexed, linked, and status-labeled.`);
