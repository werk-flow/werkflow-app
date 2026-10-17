import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  EMPTY_TREE,
  hooksPathProblem,
  parsePushUpdates,
  publishesProduction,
  pushDiffBase,
} from './push-refs';

const local = 'a'.repeat(40);
const remote = 'b'.repeat(40);
const zero = '0'.repeat(40);

test('git ref lines become updates; a deletion and a malformed line publish nothing', () => {
  const stdin = [
    `refs/heads/main ${local} refs/heads/partner-preview ${remote}`,
    `refs/heads/main ${local} refs/heads/new-branch ${zero}`,
    `(delete) ${zero} refs/heads/old ${remote}`,
    'garbage',
    '',
  ].join('\r\n');
  expect(parsePushUpdates(stdin)).toEqual([
    { localRef: 'refs/heads/main', local, remoteRef: 'refs/heads/partner-preview', remote },
    { localRef: 'refs/heads/main', local, remoteRef: 'refs/heads/new-branch', remote: undefined },
  ]);
  expect(parsePushUpdates('')).toEqual([]);
});

test('the diff base is the remote commit, else production, else the empty tree', () => {
  const update = { localRef: 'refs/heads/main', local, remoteRef: 'refs/heads/partner-preview', remote };
  expect(pushDiffBase(update, () => true)).toBe(remote);
  // A remote commit this clone lacks compares with what production holds.
  expect(pushDiffBase(update, (commit) => commit === 'origin/main')).toBe('origin/main');
  // A new remote ref has no remote commit.
  expect(pushDiffBase({ ...update, remote: undefined }, (commit) => commit === 'origin/main')).toBe(
    'origin/main',
  );
  expect(pushDiffBase({ ...update, remote: undefined }, () => false)).toBe(EMPTY_TREE);
});

test('only an update of the remote main branch publishes production', () => {
  const preview = { localRef: 'refs/heads/main', local, remoteRef: 'refs/heads/partner-preview', remote };
  expect(publishesProduction([preview])).toBe(false);
  expect(publishesProduction([preview, { ...preview, remoteRef: 'refs/heads/main' }])).toBe(true);
  expect(publishesProduction([{ ...preview, remoteRef: 'refs/heads/main-preview' }])).toBe(false);
});

test('the gate counts only while core.hooksPath names .githooks, relative or absolute', () => {
  const root = resolve('/work/werkflow-app');
  expect(hooksPathProblem('.githooks', root)).toBeUndefined();
  expect(hooksPathProblem('.githooks/', root)).toBeUndefined();
  expect(hooksPathProblem(resolve(root, '.githooks'), root)).toBeUndefined();
  for (const configured of [undefined, '', '  ', '.git/hooks', 'hooks', resolve('/elsewhere/.githooks')])
    expect(hooksPathProblem(configured, root)).toContain('git config core.hooksPath .githooks');
});
