// A complete slice has an automated browser proof of its own outcome (docs/plans/phase-1/protocol.md,
// "A slice still needs an automated browser proof of its own outcome"): a test or describe title in a
// browser spec carries the slice tag (`@P1-24`), or the slice's golden gate (gates.md, "Run after")
// names a spec whose titles carry the gate tag (`@GG-01`).
import ts from 'typescript';

type ProofElsewhere = { file: string; title: string; reason: string };

/**
 * Complete slices whose own tag no browser title carries, each with the test that proves the outcome.
 * Shrink-only: a new slice tags its own browser test instead of joining this list.
 */
export const SLICES_PROVEN_ELSEWHERE: Readonly<Record<string, ProofElsewhere>> = {
  'P1-00a': {
    file: 'tests/canary/canary.spec.ts',
    title: 'C2: Direkter R2-Upload und Download-Roundtrip',
    reason: 'R2 file storage exists only in the cloud, so the cloud canary proves the byte round trip.',
  },
};

const TAG_PATTERN = /@((?:P1-\d{2}a?)|(?:GG-\d{2}))(?![0-9a-z])/g;

// A `test.skip(...)` or `test.fixme(...)` title never runs, so it proves nothing.
const NEVER_RUNS = new Set(['skip', 'fixme']);

function isTitledTestCall(node: ts.CallExpression): boolean {
  let callee: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(callee)) {
    if (NEVER_RUNS.has(callee.name.text)) return false;
    callee = callee.expression;
  }
  return ts.isIdentifier(callee) && callee.text === 'test';
}

/** The literal titles of the `test(...)` and `test.describe(...)` calls of a spec. */
export function readTestTitles(file: string, source: string): string[] {
  const titles: string[] = [];
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isTitledTestCall(node)) {
      const title = node.arguments[0];
      if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title)))
        titles.push(title.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return titles;
}

/** The `@P1-XX` and `@GG-NN` tags of a spec's titles. */
export function titleTags(titles: readonly string[]): Set<string> {
  return new Set(
    titles.flatMap((title) => [...title.matchAll(TAG_PATTERN)].flatMap((match) => match[1] ?? [])),
  );
}

type GoldenGate = { id: string; runAfter: string[]; spec: string | null };

/** Each `### \`GG-NN\`` section of gates.md with the slices of its "Run after" line and its spec path. */
export function readGoldenGates(markdown: string): GoldenGate[] {
  return markdown
    .split(/^### /m)
    .slice(1)
    .flatMap((section) => {
      const id = section.match(/^`(GG-\d{2})`/)?.[1];
      if (!id) return [];
      const runAfterLine = section.match(/^\*\*Run after:\*\*(.*)$/m)?.[1] ?? '';
      const runAfter = [...runAfterLine.matchAll(/`(P1-\d{2}a?)`/g)].flatMap((match) => match[1] ?? []);
      const spec = section.match(/^Spec: `([^`]+\.spec\.ts)`/m)?.[1] ?? null;
      return [{ id, runAfter, spec }];
    });
}

export function findSlicesWithoutBrowserProof(input: {
  completeSlices: readonly string[];
  gates: readonly GoldenGate[];
  /** Repository-relative browser spec path to its literal test and describe titles. */
  specTitles: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const tagsBySpec = new Map([...input.specTitles].map(([file, titles]) => [file, titleTags(titles)]));
  const taggedAnywhere = new Set([...tagsBySpec.values()].flatMap((tags) => [...tags]));
  const problems = Object.entries(SLICES_PROVEN_ELSEWHERE).flatMap(([slice, proof]) => {
    if (!input.completeSlices.includes(slice))
      return [`${slice} is listed in SLICES_PROVEN_ELSEWHERE but is not a complete roadmap slice; remove it`];
    if (!input.specTitles.get(proof.file)?.includes(proof.title))
      return [`${slice} names "${proof.title}" in ${proof.file} as its proof, but that test does not exist`];
    if (taggedAnywhere.has(slice))
      return [`${slice} now has a tagged browser test; remove it from SLICES_PROVEN_ELSEWHERE`];
    return [];
  });
  for (const slice of input.completeSlices) {
    if (taggedAnywhere.has(slice) || slice in SLICES_PROVEN_ELSEWHERE) continue;
    const gateProof = input.gates.some(
      (gate) =>
        gate.runAfter.includes(slice) &&
        gate.spec !== null &&
        tagsBySpec.get(gate.spec)?.has(gate.id) === true,
    );
    if (!gateProof)
      problems.push(
        `${slice} is complete, but no test or describe title under tests/golden, tests/audit or tests/canary carries @${slice}, and no golden gate that runs after it has a spec whose titles carry the gate tag; tag the test that proves the slice's outcome`,
      );
  }
  return problems;
}
