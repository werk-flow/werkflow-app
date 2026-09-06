import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { calculateBuildInputs } from "./build-identity";

/** Application, environment, database and test inputs qualify proof; prose remains archival provenance. */
export function calculateCandidateFingerprint(repositoryRoot: string, environment: NodeJS.ProcessEnv = process.env): string {
  const build = calculateBuildInputs(repositoryRoot, environment);
  const hash = createHash("sha256").update(build.sourceDigest).update(build.environmentDigest);
  const paths: string[] = [];
  function visit(relative: string, unitTestsOnly = false): void {
    const directory = join(repositoryRoot, relative);
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Candidate identity requires real test inputs: ${path}`);
      if (entry.isDirectory()) visit(path, unitTestsOnly);
      else if (!entry.name.endsWith(".md") && (!unitTestsOnly || /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name))) paths.push(path);
    }
  }
  for (const directory of ["tests", "scripts", "supabase/migrations", "supabase/tests", "lib/testing", "lib/docs", "eslint-rules"]) visit(directory);
  visit('lib', true);
  for (const entry of readdirSync(repositoryRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^playwright.*\.config\.[cm]?[jt]s$/.test(entry.name)) paths.push(entry.name);
  }
  for (const path of ['supabase/config.toml', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.js', 'bunfig.toml']) {
    if (existsSync(join(repositoryRoot, path))) paths.push(path);
  }
  for (const path of [...new Set(paths)].sort()) hash.update(path).update("\0").update(readFileSync(join(repositoryRoot, path))).update("\0");
  return hash.digest("hex");
}
