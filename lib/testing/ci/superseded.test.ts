// A runner spends no time on a pull request run a newer push superseded, and an unanswered question runs the job.
import { expect, test } from 'bun:test';
import { lsRemoteCommit, supersedingHead } from './superseded';

const TESTED = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const REF = 'refs/pull/568/head';
const remote = (heads: Record<string, string>) => (ref: string) => heads[ref];

test('a pull request run whose head moved names the newer head; the current head, or no answer, runs', () => {
  const ask = (remoteHead: (ref: string) => string | undefined) =>
    supersedingHead({ event: 'pr', headRef: REF, testedHead: TESTED, remoteHead });
  expect(ask(remote({ [REF]: NEWER }))).toBe(NEWER);
  expect(ask(remote({ [REF]: TESTED }))).toBe(undefined);
  expect(ask(remote({}))).toBe(undefined);
});

test('only a pull request run with a head ref is ever superseded: integration, main and full runs always run', () => {
  for (const event of ['integration', 'main', 'full'] as const)
    expect(
      supersedingHead({ event, headRef: REF, testedHead: TESTED, remoteHead: remote({ [REF]: NEWER }) }),
    ).toBe(undefined);
  expect(
    supersedingHead({
      event: 'pr',
      headRef: undefined,
      testedHead: TESTED,
      remoteHead: remote({ [REF]: NEWER }),
    }),
  ).toBe(undefined);
});

test('git ls-remote output names the commit of exactly the asked ref', () => {
  const output = `${NEWER}\trefs/pull/568/head\n${TESTED}\trefs/pull/568/merge\n`;
  expect(lsRemoteCommit(output, REF)).toBe(NEWER);
  expect(lsRemoteCommit(output, 'refs/pull/56/head')).toBe(undefined);
  expect(lsRemoteCommit('', REF)).toBe(undefined);
  expect(lsRemoteCommit(`not-a-commit\t${REF}\n`, REF)).toBe(undefined);
});
