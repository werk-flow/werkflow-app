/** The branch `check:changed` compares with: the merge base of HEAD and this ref. */
export const CHANGED_CHECK_BASE = 'origin/main';

const FORMATTED = /\.(?:ts|tsx|mjs|js|cjs|json|jsonc|css)$/;
const LINTED = /\.(?:ts|tsx|mjs|js|cjs)$/;
const UNIT_TEST = /^lib\/.+\.test\.(?:ts|tsx|mjs)$/;
const SOURCE = /^(lib\/.+)\.(?:ts|tsx|mjs)$/;

export type ChangedCheckPlan = {
  formatted: string[];
  linted: string[];
  /** Changed unit test files and the test files beside changed modules, in the runner's sorted order. */
  unitTests: string[];
};

/** What `check:changed` runs for a set of changed files, each relative to the repository root. */
export function changedCheckPlan(
  changed: readonly string[],
  exists: (file: string) => boolean,
): ChangedCheckPlan {
  const unitTests = new Set<string>();
  for (const file of changed) {
    if (UNIT_TEST.test(file)) {
      unitTests.add(file);
      continue;
    }
    const stem = SOURCE.exec(file)?.[1];
    if (!stem) continue;
    for (const extension of ['ts', 'tsx', 'mjs']) {
      const candidate = `${stem}.test.${extension}`;
      if (exists(candidate)) unitTests.add(candidate);
    }
  }
  return {
    formatted: changed.filter((file) => FORMATTED.test(file)),
    linted: changed.filter((file) => LINTED.test(file)),
    unitTests: [...unitTests].map((file) => `./${file}`).sort(),
  };
}
