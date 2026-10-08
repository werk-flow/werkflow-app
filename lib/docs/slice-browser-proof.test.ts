import { describe, expect, test } from 'bun:test';

import {
  findSlicesWithoutBrowserProof,
  readGoldenGates,
  readTestTitles,
  SLICES_PROVEN_ELSEWHERE,
  titleTags,
} from './slice-browser-proof';

const GATES = `
# Golden gates

### \`GG-01\` — Customer Request To Work

**Run after:** \`P1-02\`.

Spec: \`tests/golden/gg-01.spec.ts\` (\`@GG-01\`).

### \`GG-02\` — Schedule

**Run after:** \`P1-07\`; rerun after \`P1-08\` and \`P1-09\`.

Spec: \`tests/golden/p1-07.spec.ts\` (\`@GG-02\`).
`;

const canaryProof = SLICES_PROVEN_ELSEWHERE['P1-00a'];

function problems(input: { complete: string[]; specTitles: Record<string, string[]> }) {
  return findSlicesWithoutBrowserProof({
    completeSlices: input.complete,
    gates: readGoldenGates(GATES),
    specTitles: new Map(Object.entries(input.specTitles)),
  });
}

/** The roadmap's real exception stays satisfied, so a test sees only the problem it plants. */
function withException(input: { complete: string[]; specTitles: Record<string, string[]> }) {
  if (!canaryProof) throw new Error('The P1-00a exception is expected in SLICES_PROVEN_ELSEWHERE.');
  return problems({
    complete: [...input.complete, 'P1-00a'],
    specTitles: { ...input.specTitles, [canaryProof.file]: [canaryProof.title] },
  });
}

describe('readTestTitles and titleTags', () => {
  test('read the literal titles of tests and describes, not comments or other strings', () => {
    const titles = readTestTitles(
      'tests/golden/p1-24.spec.ts',
      `
      // @P1-99 in a comment is no proof.
      const label = 'Text @P1-98';
      test.describe('Personal @P1-24', () => {
        test('Ablauf @P1-24a @GG-07', async () => {});
        test.describe.serial('Nested @P1-23', () => {});
        test.skip('Übersprungen @P1-22', async () => {});
        test.fixme('Offen @P1-21', async () => {});
      });
      `,
    );
    expect(titles).toEqual(['Personal @P1-24', 'Ablauf @P1-24a @GG-07', 'Nested @P1-23']);
    expect([...titleTags(titles)].sort()).toEqual(['GG-07', 'P1-23', 'P1-24', 'P1-24a']);
  });

  test('a longer tag does not count as its prefix', () => {
    expect(titleTags(['Plantafel @P1-24a']).has('P1-24')).toBe(false);
  });
});

describe('findSlicesWithoutBrowserProof', () => {
  test('a complete slice with its own tag or a passing gate tag is proven', () => {
    expect(
      withException({
        complete: ['P1-02', 'P1-08', 'P1-10'],
        specTitles: {
          'tests/golden/gg-01.spec.ts': ['GG-01 Anfrage zu Auftrag @GG-01'],
          'tests/golden/p1-07.spec.ts': ['Abwesenheit @GG-02'],
          'tests/audit/wave-2/a.spec.ts': ['Zeitachse @P1-10'],
        },
      }),
    ).toEqual([]);
  });

  test('a complete slice without a tag or gate proof is reported by id', () => {
    const found = withException({
      complete: ['P1-11'],
      specTitles: { 'tests/golden/gg-01.spec.ts': ['GG-01 @GG-01'] },
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toStartWith('P1-11 is complete, but no test or describe title');
  });

  test('a gate proves its slices only while its own spec carries the gate tag', () => {
    expect(
      withException({ complete: ['P1-02'], specTitles: { 'tests/golden/other.spec.ts': ['x @GG-01'] } }),
    ).toHaveLength(1);
  });

  test('a listed exception needs a complete slice and an existing proving test, and goes once the slice is tagged', () => {
    if (!canaryProof) throw new Error('The P1-00a exception is expected in SLICES_PROVEN_ELSEWHERE.');
    const proven = { [canaryProof.file]: [canaryProof.title] };
    expect(problems({ complete: ['P1-00a'], specTitles: proven })).toEqual([]);
    expect(problems({ complete: [], specTitles: proven })[0]).toContain('is not a complete roadmap slice');
    expect(problems({ complete: ['P1-00a'], specTitles: {} })[0]).toContain('that test does not exist');
    expect(
      problems({
        complete: ['P1-00a'],
        specTitles: { ...proven, 'tests/golden/x.spec.ts': ['Speicher @P1-00a'] },
      })[0],
    ).toContain('remove it from SLICES_PROVEN_ELSEWHERE');
  });
});
