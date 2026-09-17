import { expect, test } from "bun:test";
import { selectRequiredGroups } from "./group-selection";

const groups = [
  { id: "static:docs", kind: "static", inputs: ["scripts/docs.ts"] },
  { id: "golden:gg-00", kind: "golden", inputs: ["lib/auth.ts"] },
  { id: "time", kind: "audit", inputs: ["lib/time/save.ts", "lib/auth.ts", "tests/time.ts"] },
  { id: "inventory", kind: "audit", inputs: ["lib/inventory/read.ts", "lib/auth.ts", "tests/inventory.ts"] },
];
const select = (changedFiles: string[], unresolvedGroupIds: string[] = []): string[] => selectRequiredGroups({ mode: "change", groups, changedFiles, unresolvedGroupIds });
test("a feature change selects its actual readers and core journey without unrelated missing proof", () => {
  expect(select(["lib/time/save.ts"])).toEqual(["static:docs", "golden:gg-00", "time"]);
  expect(select(["tests/time.ts"])).toEqual(["static:docs", "time"]);
});
test("shared and unknown or deleted inputs select broad coverage", () => {
  expect(select(["lib/auth.ts"])).toHaveLength(4);
  expect(select(["removed-unmapped-file.ts"])).toHaveLength(4);
  expect(select(["<environment>"])).toHaveLength(4);
});
test("documentation-only changes do not require missing unrelated browser proof; unresolved groups stay visible", () => {
  expect(select([])).toEqual(["static:docs"]);
  expect(select([], ["time"])).toEqual(["static:docs", "time"]);
  expect(selectRequiredGroups({ mode: "release", groups, changedFiles: [], unresolvedGroupIds: [] })).toHaveLength(4);
});

test('network dependency gate runs for dependency changes and release, not ordinary application edits', () => {
  const withDependencies = [...groups, { id: 'static:dependencies', kind: 'static', inputs: ['bun.lock', 'package.json'] }];
  const choose = (changedFiles: string[], mode: 'change' | 'release' = 'change', unresolvedGroupIds: string[] = []) =>
    selectRequiredGroups({ mode, groups: withDependencies, changedFiles, unresolvedGroupIds });
  expect(choose(['bun.lock'])).toContain('static:dependencies');
  expect(choose(['package.json'])).toContain('static:dependencies');
  expect(choose([], 'release')).toContain('static:dependencies');
  expect(choose([], 'change', ['static:dependencies'])).toContain('static:dependencies');
  expect(choose(['app/new-page.tsx'])).not.toContain('static:dependencies');
  expect(choose([])).not.toContain('static:dependencies');
});
