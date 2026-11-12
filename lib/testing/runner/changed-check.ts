/** The branch `check:changed` compares with: the merge base of HEAD and this ref. */
export const CHANGED_CHECK_BASE = 'origin/main';

const FORMATTED = /\.(?:ts|tsx|mjs|js|cjs|json|jsonc|css)$/;
const LINTED = /\.(?:ts|tsx|mjs|js|cjs)$/;
const UNIT_TEST = /^lib\/.+\.test\.(?:ts|tsx|mjs)$/;
const SOURCE = /^(lib\/.+)\.(?:ts|tsx|mjs)$/;

export type ChangedCheckPlan = {
  formatted: string[];
  linted: string[];
  /**
   * Changed unit test files, the test files beside changed modules, and the unit tests that name a
   * changed file outside lib/ or its folder by path, in the runner's sorted order.
   */
  unitTests: string[];
};

/** Whether a test's source names `file`, or a folder of it two levels deep or more, as a string literal. */
function namesPath(source: string, file: string): boolean {
  const segments = file.split('/');
  const paths = [file, ...segments.slice(2).map((_, index) => segments.slice(0, index + 2).join('/'))];
  return paths.some((path) =>
    ["'", '"', '`'].some(
      (quote) => source.includes(`${quote}${path}${quote}`) || source.includes(`${quote}${path}/`),
    ),
  );
}

/** What `check:changed` runs for a set of changed files, each relative to the repository root. */
export function changedCheckPlan(
  changed: readonly string[],
  exists: (file: string) => boolean,
  unitTestSources: ReadonlyMap<string, string> = new Map(),
): ChangedCheckPlan {
  const unitTests = new Set<string>();
  for (const file of changed) {
    if (UNIT_TEST.test(file)) {
      unitTests.add(file);
      continue;
    }
    // A convention test reads package.json, a config or the specs of a folder by path, never by import.
    if (!file.startsWith('lib/'))
      for (const [test, source] of unitTestSources) if (namesPath(source, file)) unitTests.add(test);
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
