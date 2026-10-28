import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tier 2 for the CI supply chain. A tag such as `@v6` can move to new code
// without a change here, and the workflows hold deploy keys and DEV and PROD
// credentials. Every action outside this repository is pinned to a full
// commit SHA, with its release as a comment so an update shows what it moves
// to. A local action (`./.github/actions/...`) is reviewed with this repository.

const repositoryRoot = resolve(import.meta.dir, '../..');
const USES = /^\s*(?:-\s+)?uses:\s*['"]?([^\s'"#]+)['"]?\s*(#.*)?$/;
const PINNED = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const RELEASE_COMMENT = /^#\s*v\d+\.\d+\.\d+\s*$/;

function unpinnedActions(file: string, text: string): string[] {
  return text.split('\n').flatMap((line, index) => {
    const match = USES.exec(line);
    if (!match?.[1] || match[1].startsWith('./')) return [];
    const pinned = PINNED.test(match[1]) && RELEASE_COMMENT.test(match[2] ?? '');
    return pinned ? [] : [`${file}:${index + 1} ${match[1]}`];
  });
}

function workflowFiles(): string[] {
  return readdirSync(resolve(repositoryRoot, '.github'), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => `.github/${name}`)
    .sort();
}

test('every action outside this repository is pinned to a commit SHA with its release', () => {
  const unpinned = workflowFiles().flatMap((file) =>
    unpinnedActions(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  expect(unpinned, 'Pin to the full commit SHA of the release: `owner/repo@<sha> # vX.Y.Z`').toEqual([]);
});

test('the scan refuses a tag, a short SHA and a pin without its release', () => {
  const sha = 'd23441a48e516b6c34aea4fa41551a30e30af803';
  const sample = [
    '      - uses: actions/checkout@v6',
    `      - uses: actions/checkout@${sha.slice(0, 7)} # v6.1.0`,
    `      uses: actions/cache/restore@${sha}`,
    `      - uses: "actions/checkout@${sha}" # v6.1.0`,
    '      - uses: ./.github/actions/setup',
  ].join('\n');
  expect(unpinnedActions('sample.yml', sample)).toEqual([
    'sample.yml:1 actions/checkout@v6',
    'sample.yml:2 actions/checkout@d23441a',
    `sample.yml:3 actions/cache/restore@${sha}`,
  ]);
});
