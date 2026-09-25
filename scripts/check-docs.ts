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

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { findCodeRabbitInstructionViolations } from "../lib/testing/coderabbit-review-command";
import { findSliceRecordProblems } from "../lib/docs/slice-records";

const repoRoot = resolve(import.meta.dir, "..");
const docsRoot = join(repoRoot, "docs");

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

const docFiles = collectFiles(docsRoot).filter((file) => file.endsWith(".md"));
const problems: string[] = [];

// 1. Index coverage
const indexContent = readFileSync(join(docsRoot, "README.md"), "utf8");
const sliceFolderCovered = indexContent.includes("phase-1/slices");
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  if (relPath === "README.md") continue;
  if (relPath.startsWith("plans/phase-1/slices/")) {
    if (!sliceFolderCovered) {
      problems.push(`index: ${relPath} relies on the phase-1/slices folder row, which is missing from docs/README.md`);
    }
    continue;
  }
  if (!indexContent.includes(`(${relPath})`) && !indexContent.includes(`(${relPath}#`)) {
    problems.push(`index: ${relPath} is not linked from docs/README.md — add it to the index or retire the file`);
  }
}

// 2. Relative link resolution, including heading anchors: a renamed heading used to break every
//    inbound "#fragment" silently (five such links after the testing guide rewrite of 2026-09-25).
const linkPattern = /\]\(([^)\s]+)\)/g;
const anchorCache = new Map<string, Set<string>>();
function headingAnchors(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    for (const explicit of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(explicit[1] ?? "");
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading?.[1]) continue;
    const text = heading[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "");
    const slug = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  anchorCache.set(path, anchors);
  return anchors;
}
for (const file of docFiles) {
  const content = readFileSync(file, "utf8");
  const relFile = relative(repoRoot, file).split(sep).join("/");
  for (const match of content.matchAll(linkPattern)) {
    const [, target] = match;
    if (target === undefined || /^(https?:|mailto:)/.test(target)) continue;
    const [pathPart = "", fragment] = target.split("#");
    const targetPath = pathPart === "" ? file : resolve(dirname(file), pathPart);
    if (!existsSync(targetPath)) {
      problems.push(`link: ${relFile} → ${target} does not resolve`);
      continue;
    }
    if (fragment !== undefined && targetPath.endsWith(".md") && !headingAnchors(targetPath).has(decodeURIComponent(fragment))) {
      problems.push(`anchor: ${relFile} → ${target} names no heading of the target; use the heading's slug or drop the fragment`);
    }
  }
}

// 3. Status headers — must exist AND use the documented vocabulary
// (docs/README.md maintenance rule 1): living, closed, complete (slice records),
// accepted (ADRs), or pointer stub.
const statusPattern = /^(>\s*)?(-\s*)?\*{0,2}Status:?\*{0,2}/i;
const statusVocabulary = /(living|closed|complete|accepted|pointer stub)/i;
for (const file of docFiles) {
  const firstLines = readFileSync(file, "utf8").split("\n").slice(0, 6);
  const statusLine = firstLines.find((line) => statusPattern.test(line));
  const relFile = relative(repoRoot, file).split(sep).join("/");
  if (statusLine === undefined) {
    problems.push(`status: ${relFile} has no Status header in its first 6 lines`);
  } else if (!statusVocabulary.test(statusLine)) {
    problems.push(`status: ${relFile} status line uses none of the documented states (living/closed/complete/accepted/pointer stub): "${statusLine.trim()}"`);
  }
}

// 4. Skill mirror sync
// Deliberately unmirrored .claude-only skills must be listed here with a reason,
// otherwise a one-sided skill fails the check in BOTH directions.
const claudeOnlySkillExceptions = new Set([
  "coderabbit-review", // Codex ships its own CodeRabbit skill; mirroring would duplicate it
]);
const claudeSkillsRoot = join(repoRoot, ".claude", "skills");
const agentsSkillsRoot = join(repoRoot, ".agents", "skills");
if (existsSync(claudeSkillsRoot) && existsSync(agentsSkillsRoot)) {
  const claudeSkills = new Set(readdirSync(claudeSkillsRoot));
  const agentsSkills = new Set(readdirSync(agentsSkillsRoot));
  for (const skillName of claudeSkills) {
    if (!agentsSkills.has(skillName)) {
      if (!claudeOnlySkillExceptions.has(skillName)) {
        problems.push(`skills: ${skillName} exists only in .claude/skills — mirror it or add it to claudeOnlySkillExceptions in scripts/check-docs.ts with a reason`);
      }
      continue;
    }
    const claudeFiles = collectFiles(join(claudeSkillsRoot, skillName));
    for (const claudeFile of claudeFiles) {
      const mirrorFile = join(agentsSkillsRoot, skillName, relative(join(claudeSkillsRoot, skillName), claudeFile));
      if (!existsSync(mirrorFile)) {
        problems.push(`skills: ${skillName}/${relative(join(claudeSkillsRoot, skillName), claudeFile)} missing from .agents/skills mirror`);
      } else if (!readFileSync(claudeFile).equals(readFileSync(mirrorFile))) {
        problems.push(`skills: ${skillName} drifted between .claude/skills and .agents/skills — re-sync the mirror`);
      }
    }
    for (const agentsFile of collectFiles(join(agentsSkillsRoot, skillName))) {
      const relativePath = relative(join(agentsSkillsRoot, skillName), agentsFile);
      if (!existsSync(join(claudeSkillsRoot, skillName, relativePath))) {
        problems.push(`skills: ${skillName}/${relativePath} exists only in .agents/skills; mirror it in .claude/skills`);
      }
    }
  }
  for (const skillName of agentsSkills) {
    if (!claudeSkills.has(skillName)) {
      problems.push(`skills: ${skillName} exists only in .agents/skills — mirror it or record the exception in docs/README.md`);
    }
  }
}

// 5. CodeRabbit workflow
const codeRabbitInstructionFiles = [
  join(repoRoot, "AGENTS.md"),
  join(repoRoot, ".claude", "skills", "coderabbit-review", "SKILL.md"),
  join(docsRoot, "technical", "coderabbit.md"),
];
for (const file of codeRabbitInstructionFiles) {
  if (!existsSync(file)) {
    const relFile = relative(repoRoot, file).split(sep).join("/");
    problems.push(`coderabbit: expected instruction file ${relFile} is missing`);
    continue;
  }
  const content = readFileSync(file, "utf8");
  const relFile = relative(repoRoot, file).split(sep).join("/");
  if (!content.includes("bun run review")) {
    problems.push(
      `coderabbit: ${relFile} must route agents through bun run review`,
    );
  }
  for (const violation of findCodeRabbitInstructionViolations(content)) {
    problems.push(
      `coderabbit: ${relFile} contains forbidden ${violation} instructions; use bun run review`,
    );
  }
}

const packageJsonContent = readFileSync(join(repoRoot, "package.json"), "utf8");
if (!packageJsonContent.includes('"review": "bun scripts/run-coderabbit-review.ts"')) {
  problems.push(
    "coderabbit: package.json must expose bun scripts/run-coderabbit-review.ts as the review script",
  );
}
if (!existsSync(join(repoRoot, "scripts", "run-coderabbit-review.ts"))) {
  problems.push("coderabbit: scripts/run-coderabbit-review.ts is missing");
}

// 6. Status line position and shape (docs/README.md maintenance rule 1, tightened 2026-09-03
//    after the post-Wave-2 docs audit found seven incompatible slice-record formats, a status
//    line hidden on line 5, and index rows disagreeing with their targets).
//    Line 1 is the H1, line 2 is blank, line 3 is the status line in the genre's exact shape.
const livingStatusPattern = /^Status: living — last reviewed \d{4}-\d{2}-\d{2}(; .+)?$/;
const closedStatusPattern = /^Status: closed \(\d{4}-\d{2}-\d{2}\) — .+$/;
const decisionStatusPattern = /^- \*\*Status:\*\* accepted \(\d{4}-\d{2}-\d{2}\)( — .+)?$/;

function readDocStatus(file: string): { kind: "living" | "closed" | "accepted" | "pointer stub"; date: string | null } | null {
  const lines = readFileSync(file, "utf8").split("\n");
  const relFile = relative(repoRoot, file).split(sep).join("/");
  if (!lines[0]?.startsWith("# ")) {
    problems.push(`status: ${relFile} must start with an H1 on line 1`);
    return null;
  }
  if ((lines[1] ?? "").trim() !== "") {
    problems.push(`status: ${relFile} needs one blank line between the H1 and the status line`);
    return null;
  }
  const statusLine = (lines[2] ?? "").trimEnd();
  const isDecision = relFile.startsWith("docs/decisions/");
  const pattern = isDecision
    ? decisionStatusPattern
    : statusLine.startsWith("Status: closed")
        ? closedStatusPattern
        : livingStatusPattern;
  if (!pattern.test(statusLine)) {
    problems.push(
      `status: ${relFile} line 3 must match ${pattern} (docs/README.md maintenance rule 1); found: "${statusLine}"`,
    );
    return null;
  }
  const date = statusLine.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  if (isDecision) return { kind: "accepted", date };
  return { kind: statusLine.startsWith("Status: closed") ? "closed" : "living", date };
}

const docStatuses = new Map<string, ReturnType<typeof readDocStatus>>();
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  docStatuses.set(relPath, readDocStatus(file));
}

// 7. Backtick doc paths inside docs/ (maintenance rule 3): a doc-to-doc reference must be a
//    relative markdown link so the resolver above can check it. Append-only logs are exempt
//    because their historical entries are immutable.
const backtickDocPathExemptFiles = new Set([
  "plans/phase-1/log.md",
  "plans/phase-1/audits/golden-gate-log.md",
  "technical/test-incident-log.md",
]);
// Any backticked Markdown path, not only docs/- or ../-prefixed ones (Step 3, 2026-09-13):
// bare sibling paths such as `phase-1/protocol.md` escaped the earlier prefix-only pattern.
// AGENTS.md, CLAUDE.md and skill/memory files are code-facing names, not doc links.
const backtickDocPathPattern = /`((?:docs\/|\.\.\/)?[A-Za-z0-9_-][A-Za-z0-9_./-]*\.md)`/g;
// A backticked name counts only when it names a real document under docs/; artifact names
// such as `error-context.md` and code-facing files (AGENTS.md, SKILL.md) are not doc links.
const docPathsByBasename = new Map<string, string[]>();
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  const basename = relPath.split("/").pop()!;
  docPathsByBasename.set(basename, [...(docPathsByBasename.get(basename) ?? []), relPath]);
}
function namesExistingDoc(fromRelPath: string, reference: string): boolean {
  const cleaned = reference.replace(/^docs\//, "");
  const fromDir = fromRelPath.includes("/") ? fromRelPath.slice(0, fromRelPath.lastIndexOf("/")) : "";
  const candidates = [cleaned, join(fromDir, cleaned).split(sep).join("/")];
  if (candidates.some((candidate) => existsSync(join(docsRoot, candidate)))) return true;
  return !cleaned.includes("/") && docPathsByBasename.has(cleaned);
}
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  if (relPath === "README.md" || backtickDocPathExemptFiles.has(relPath)) continue;
  let insideFence = false;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) insideFence = !insideFence;
    if (insideFence || line.trimStart().startsWith(">")) return;
    // Link text may legitimately carry a backticked file name: [`x.md`](x.md).
    const withoutLinks = line.replace(/\[[^\]]*\]\([^)]*\)/g, "");
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
  if (prefix === "Complete" || prefix === "Accepted") {
    problems.push(`index: row for ${target} uses "${prefix} —"; index rows say "Closed —" or "Living —" only`);
    continue;
  }
  if (status && status.kind !== prefix.toLowerCase()) {
    problems.push(`index: row for ${target} says "${prefix}" but the doc's status line says "${status.kind}"`);
  }
}

// 9. Roadmap invariants (docs/plans/phase-1/protocol.md status model): the accepted counter
//    equals the number of `complete` rows, and the ready set is recomputed (a `planned` slice has
//    an unaccepted prerequisite; a slice whose prerequisites are all complete is not `planned`).
//    Every complete row links its slice record, and the record's closed date matches the row.
const roadmapPath = join(docsRoot, "plans", "phase-1", "roadmap.md");
const roadmapContent = readFileSync(roadmapPath, "utf8");
const sliceRowPattern = /^\| `(P1-\d{2}a?)`\s*\| `([a-z_]+)`\s*\| .*?\| ([^|]*)\| [^|]*\| ([^|]*)\|\s*$/gm;
const sliceRows = new Map<string, { status: string; dependencies: string[]; exitEvidence: string }>();
for (const match of roadmapContent.matchAll(sliceRowPattern)) {
  const [, id, status, dependencyCell, exitEvidence] = match;
  if (id === undefined || status === undefined || dependencyCell === undefined || exitEvidence === undefined) continue;
  const dependencies = [...dependencyCell.matchAll(/`(P1-\d{2}a?)`/g)].flatMap((entry) => entry[1] ?? []);
  sliceRows.set(id, { status, dependencies, exitEvidence });
}
const completeCount = [...sliceRows.values()].filter((row) => row.status === "complete").length;
const counterMatch = roadmapContent.match(/\*\*Formally accepted roadmap slices:\*\* (\d+) of (\d+)/);
if (!counterMatch) {
  problems.push("roadmap: the accepted-slices counter line is missing from docs/plans/phase-1/roadmap.md");
} else {
  if (Number(counterMatch[1]) !== completeCount) {
    problems.push(`roadmap: counter says ${counterMatch[1]} accepted but the slice index has ${completeCount} complete rows`);
  }
  if (Number(counterMatch[2]) !== sliceRows.size) {
    problems.push(`roadmap: counter says ${counterMatch[2]} slices but the slice index has ${sliceRows.size} rows`);
  }
}
for (const [id, row] of sliceRows) {
  const allDependenciesComplete = row.dependencies.every((dependency) => sliceRows.get(dependency)?.status === "complete");
  if (row.status === "planned" && allDependenciesComplete) {
    problems.push(`roadmap: ${id} is planned but every direct prerequisite is complete; recompute the ready set (protocol.md status model)`);
  }
  if (row.status === "ready" && !allDependenciesComplete) {
    problems.push(`roadmap: ${id} is ready but a direct prerequisite is not complete`);
  }
  if (row.status !== "complete") continue;
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
  if (recordStatus?.kind !== "closed") {
    problems.push(`roadmap: complete row ${id} links ${recordPath}, whose status line is not closed`);
  } else if (rowDate && recordStatus.date !== rowDate) {
    problems.push(`roadmap: ${id} row says accepted ${rowDate} but ${recordPath} is closed (${recordStatus.date})`);
  }
}

// 11. One document per slice (protocol.md "Before Starting A Slice" step 7, decided 2026-09-03 after
//     eight slices had grown a second "implementation plan" file that overlapped their record):
//     a per-slice file (named p1-XX-*) may exist only under plans/phase-1/slices/, and nothing
//     there is named an implementation plan. Cross-slice plans such as the Inventory V1 plan are unaffected.
problems.push(...findSliceRecordProblems({
  paths: docFiles.map((file) => relative(docsRoot, file).split(sep).join("/")),
  sliceIds: new Set([...sliceRows.keys()].map((id) => id.toUpperCase())),
}).map((problem) => `slices: ${problem}`));

// 10. User-flow catalog: slice sections in ID order, flow IDs unique and sequential per slice,
//     and the acceptance-invariant count equal to the section's flow count.
const catalogContent = readFileSync(join(docsRoot, "product", "user-flow-catalog.md"), "utf8");
const catalogSections = [...catalogContent.matchAll(/^### `(P1-\d{2}a?)`[^\n]*\n([\s\S]*?)(?=^### |\n## |$(?![\s\S]))/gm)];
let previousSliceKey = "";
const seenFlowIds = new Set<string>();
for (const [, sliceId, body] of catalogSections) {
  if (sliceId === undefined || body === undefined) continue;
  const sliceKey = sliceId.padEnd(6, " ");
  if (sliceKey < previousSliceKey) {
    problems.push(`catalog: section ${sliceId} is out of ID order in docs/product/user-flow-catalog.md`);
  }
  previousSliceKey = sliceKey;
  const definedFlowIds = [...body.matchAll(new RegExp(`^- \`(${sliceId}-F\\d{2,3})\``, "gm"))].flatMap((entry) => entry[1] ?? []);
  definedFlowIds.forEach((flowId, index) => {
    if (seenFlowIds.has(flowId)) problems.push(`catalog: flow ID ${flowId} is defined twice`);
    seenFlowIds.add(flowId);
    const expected = `${sliceId}-F${String(index + 1).padStart(2, "0")}`;
    if (flowId !== expected) problems.push(`catalog: ${sliceId} flow IDs are not sequential; expected ${expected}, found ${flowId}`);
  });
  const invariant = body.match(/\*\*Acceptance invariant:\*\* `(\d+)\/(\d+) mapped/);
  if (invariant && Number(invariant[1]) !== definedFlowIds.length) {
    problems.push(`catalog: ${sliceId} invariant says ${invariant[1]} flows but the section defines ${definedFlowIds.length}`);
  }
}

// 12. Incident tiers (decision 0005; mechanized in pre-Wave-3 step 1, 2026-09-14, after the Step 3
//     campaign wrote entries whose prevention named no tier): every dated section of the incident
//     log from the decision's adoption date names Tier 1 or Tier 2, names Tier 3 with a reason in the
//     same sentence, or states that no prevention claim follows. Sections before that date are history.
const incidentLogRelativePath = "technical/test-incident-log.md";
const incidentTierRulePattern = /\bTier [12]\b|\bTier 3\b[^.\n]*(?::|\bbecause\b|\()|\bno (?:\w+ )*prevention claim\b/i;
const incidentTierSince = "2026-08-27";
for (const section of readFileSync(join(docsRoot, incidentLogRelativePath), "utf8").split(/^(?=#{2,3} )/m)) {
  const heading = section.split("\n")[0] ?? "";
  const date = heading.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!heading.startsWith("#") || !date || date < incidentTierSince) continue;
  if (incidentTierRulePattern.test(section)) continue;
  problems.push(
    `incident-tier: docs/${incidentLogRelativePath} "${heading.replace(/^#+ /, "")}" names no enforcement tier; end the entry with Tier 1 or Tier 2, "Tier 3: <why no mechanism reaches it>" or "no prevention claim" (decision 0005)`,
  );
}

// 13. Deletion pass and independent review (protocol.md "Deletion Pass And Independent Review",
//     pre-Wave-3 step 2, 2026-09-14): a slice record closed from 2026-09-15 on carries the section
//     with the diff size before and after the pass (two `git diff --shortstat` lines) and the
//     `bun run review` command with its finding dispositions, so a slice cannot close without both.
const deletionPassSince = "2026-09-15";
for (const [file, status] of docStatuses) {
  if (!file.startsWith("plans/phase-1/slices/") || status?.kind !== "closed" || !status.date || status.date < deletionPassSince) continue;
  const section = readFileSync(join(docsRoot, file), "utf8").match(/^## Deletion pass and review\n([\s\S]*?)(?=^## |$(?![\s\S]))/im)?.[1];
  if (!section) {
    problems.push(`deletion-pass: docs/${file} closes without a "## Deletion Pass And Review" section (protocol.md, Deletion Pass And Independent Review)`);
    continue;
  }
  if ((section.match(/\d+ files? changed/g) ?? []).length < 2) {
    problems.push(`deletion-pass: docs/${file} must record the git diff --shortstat line before and after the deletion pass`);
  }
  if (!/bun run review\b/.test(section)) {
    problems.push(`deletion-pass: docs/${file} must record the bun run review command it ran and the disposition of every finding`);
  }
}

// 14. Single-use plan records are history only (docs/README.md maintenance rule 6, owner rule of
//     2026-09-17): a slice record, hardening, consolidation, audit or pre-wave record that closes from
//     2026-09-17 on must carry a "## Durable homes" section naming the living doc that now states
//     every fact a later agent needs, because nobody reopens a closed record unprompted. The living
//     roadmap family (roadmap, protocol, gates, coverage, log) is exempt.
const durableHomesSince = "2026-09-17";
const livingRoadmapFamily = new Set(["plans/phase-1/roadmap.md", "plans/phase-1/protocol.md", "plans/phase-1/gates.md", "plans/phase-1/coverage.md", "plans/phase-1/log.md"]);
for (const [file, status] of docStatuses) {
  if (!file.startsWith("plans/") || livingRoadmapFamily.has(file) || status?.kind !== "closed" || !status.date || status.date < durableHomesSince) continue;
  const section = readFileSync(join(docsRoot, file), "utf8").match(/^## Durable homes\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/im)?.[1];
  if (!section || section.trim().length === 0) {
    problems.push(`durable-homes: docs/${file} closes without a "## Durable homes" section naming where its lasting facts now live (docs/README.md maintenance rule 6)`);
  }
}

if (problems.length > 0) {
  console.error(`docs:check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`docs:check passed — ${docFiles.length} docs indexed, linked, and status-labeled.`);
