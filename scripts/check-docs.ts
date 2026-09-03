// Validates the docs/ knowledge structure so drift fails loudly instead of rotting silently.
// Run with: bun run docs:check
//
// Checks:
//  1. Index coverage — every docs/**/*.md appears as a link target in docs/README.md
//     (files under docs/plans/phase-1/slices/ are covered by the folder row instead).
//  2. Link resolution — every relative markdown link in docs/**/*.md resolves to an existing file.
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

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { findCodeRabbitInstructionViolations } from "../lib/testing/coderabbit-review-command";

const repoRoot = resolve(import.meta.dir, "..");
const docsRoot = join(repoRoot, "docs");

function collectMarkdownFiles(dir: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      collected.push(...collectMarkdownFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      collected.push(fullPath);
    }
  }
  return collected;
}

const docFiles = collectMarkdownFiles(docsRoot);
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

// 2. Relative link resolution
const linkPattern = /\]\(([^)\s]+)\)/g;
for (const file of docFiles) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const targetPath = resolve(dirname(file), target.split("#")[0]);
    if (!existsSync(targetPath)) {
      const relFile = relative(repoRoot, file).split(sep).join("/");
      problems.push(`link: ${relFile} → ${target} does not resolve`);
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
    const claudeFiles = collectMarkdownFiles(join(claudeSkillsRoot, skillName));
    for (const claudeFile of claudeFiles) {
      const mirrorFile = join(agentsSkillsRoot, skillName, relative(join(claudeSkillsRoot, skillName), claudeFile));
      if (!existsSync(mirrorFile)) {
        problems.push(`skills: ${skillName}/${relative(join(claudeSkillsRoot, skillName), claudeFile)} missing from .agents/skills mirror`);
      } else if (readFileSync(claudeFile, "utf8") !== readFileSync(mirrorFile, "utf8")) {
        problems.push(`skills: ${skillName} drifted between .claude/skills and .agents/skills — re-sync the mirror`);
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
const pointerStubStatusPattern = /^Status: pointer stub — .+$/;

function readDocStatus(file: string): { kind: "living" | "closed" | "accepted" | "pointer stub"; date: string | null } | null {
  const lines = readFileSync(file, "utf8").split("\n");
  const relFile = relative(repoRoot, file).split(sep).join("/");
  if (relFile === "docs/README.md") return null;
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
    : relFile === "docs/plans/phase-1-build-roadmap.md"
      ? pointerStubStatusPattern
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
  if (pattern === pointerStubStatusPattern) return { kind: "pointer stub", date };
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
  "plans/golden-gate-log.md",
  "technical/test-incident-log.md",
]);
const backtickDocPathPattern = /`((?:docs\/|\.\.\/)[A-Za-z0-9_./-]+\.md)`/g;
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  if (relPath === "README.md" || backtickDocPathExemptFiles.has(relPath)) continue;
  let insideFence = false;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) insideFence = !insideFence;
    if (insideFence || line.trimStart().startsWith(">")) return;
    for (const match of line.matchAll(backtickDocPathPattern)) {
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
  const dependencies = [...dependencyCell.matchAll(/`(P1-\d{2}a?)`/g)].map((entry) => entry[1]);
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
  const recordMatch = row.exitEvidence.match(/\]\((slices\/[a-z0-9-]+\.md)\)/);
  if (!recordMatch) {
    problems.push(`roadmap: complete row ${id} does not link its slice record under slices/`);
    continue;
  }
  const recordStatus = docStatuses.get(`plans/phase-1/${recordMatch[1]}`);
  const rowDate = row.exitEvidence.match(/Accepted `?complete`? (\d{4}-\d{2}-\d{2})/)?.[1];
  if (recordStatus?.kind !== "closed") {
    problems.push(`roadmap: complete row ${id} links ${recordMatch[1]}, whose status line is not closed`);
  } else if (rowDate && recordStatus.date !== rowDate) {
    problems.push(`roadmap: ${id} row says accepted ${rowDate} but ${recordMatch[1]} is closed (${recordStatus.date})`);
  }
}

// 11. One document per slice (protocol.md "Before Starting A Slice" step 7, decided 2026-09-03 after
//     eight slices had grown a second "implementation plan" file that overlapped their record):
//     a per-slice file (named p1-XX-*) may exist only under plans/phase-1/slices/, and nothing
//     there is named an implementation plan. Cross-slice plans such as the Inventory V1 plan are unaffected.
for (const file of docFiles) {
  const relPath = relative(docsRoot, file).split(sep).join("/");
  const fileName = relPath.split("/").pop() ?? "";
  const isSliceNamed = /^p1-\d{2}a?-/.test(fileName);
  const isImplementationPlan = /implementation-plan/.test(fileName);
  if (relPath.startsWith("plans/phase-1/slices/")) {
    if (isImplementationPlan) problems.push(`slices: docs/${relPath} is named as an implementation plan; the slice record is the only per-slice document`);
    continue;
  }
  if (isSliceNamed) {
    problems.push(`slices: docs/${relPath} is a per-slice document outside plans/phase-1/slices/; fold it into the slice record (protocol.md step 7)`);
  }
}

// 10. User-flow catalog: slice sections in ID order, flow IDs unique and sequential per slice,
//     and the acceptance-invariant count equal to the section's flow count.
const catalogContent = readFileSync(join(docsRoot, "product", "user-flow-catalog.md"), "utf8");
const catalogSections = [...catalogContent.matchAll(/^### `(P1-\d{2}a?)`[^\n]*\n([\s\S]*?)(?=^### |\n## |$(?![\s\S]))/gm)];
let previousSliceKey = "";
const seenFlowIds = new Set<string>();
for (const [, sliceId, body] of catalogSections) {
  const sliceKey = sliceId.padEnd(6, " ");
  if (sliceKey < previousSliceKey) {
    problems.push(`catalog: section ${sliceId} is out of ID order in docs/product/user-flow-catalog.md`);
  }
  previousSliceKey = sliceKey;
  const definedFlowIds = [...body.matchAll(new RegExp(`^- \`(${sliceId}-F\\d{2,3})\``, "gm"))].map((entry) => entry[1]);
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

if (problems.length > 0) {
  console.error(`docs:check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`docs:check passed — ${docFiles.length} docs indexed, linked, and status-labeled.`);
