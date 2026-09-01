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

if (problems.length > 0) {
  console.error(`docs:check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`docs:check passed — ${docFiles.length} docs indexed, linked, and status-labeled.`);
