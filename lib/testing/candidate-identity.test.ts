import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateCandidateFingerprint } from "./candidate-identity";

describe("browser candidate identity", () => {
  test("ignores documentation and retained worlds but includes assertions, migrations and routing", () => {
    const root = mkdtempSync(join(tmpdir(), "werkflow-candidate-"));
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    const write = (path: string, content: string): void => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), content); };
    try {
      write("tests/audit/example.spec.ts", "assert real state");
      const initial = calculateCandidateFingerprint(root, environment);
      write("docs/testing.md", "updated record");
      write("tests/golden/.artifacts/world.json", "private generated state");
      expect(calculateCandidateFingerprint(root, environment)).toBe(initial);
      for (const path of ['lib/example.test.ts', 'lib/testing/runner.ts', 'lib/docs/check.ts', 'eslint-rules/example.mjs', 'eslint.config.mjs', 'bunfig.toml']) {
        const before = calculateCandidateFingerprint(root, environment);
        write(path, 'changed verification contract');
        expect(calculateCandidateFingerprint(root, environment)).not.toBe(before);
      }
      write("tests/audit/example.spec.ts", "changed assertion");
      const assertions = calculateCandidateFingerprint(root, environment);
      expect(assertions).not.toBe(initial);
      write("supabase/migrations/20260905_change.sql", "alter table example");
      expect(calculateCandidateFingerprint(root, environment)).not.toBe(assertions);
      expect(calculateCandidateFingerprint(root, { ...environment, NEXT_PUBLIC_SUPABASE_URL: "https://different.example" })).not.toBe(calculateCandidateFingerprint(root, environment));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
