// Rule test: a workflow or CI script calls Vercel's REST API through vercel_api, which fails on a
// refusal with Vercel's reason, never through a bare curl whose failure leaves an empty id.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryRoot } from './product-sources';

// Tier 2 after the staging deploy of 2026-11-13: `curl --fail --silent ... | jq -r .id` turned
// Vercel's HTTP 429 into an empty id, then polled it for 20 minutes without saying why. The
// scripts listed here call curl themselves and check each answer before they use it. The helper
// .github/scripts/vercel-api.sh names no host, so it needs no entry.
const OWN_STATUS_CHECK: Readonly<Record<string, string>> = {
  '.github/scripts/release-smoke.sh':
    'Each failed read falls back to an empty value that fails its check, and prints no body.',
};

const VERCEL_API = 'api.vercel.com';
const CURL_CALL = /(?:^|[\s(;|&{`])curl\s/m;
const PIPED_HELPER = /vercel_api\b[^\n]*\|/;

function files(folder: string): string[] {
  return readdirSync(join(repositoryRoot, folder), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(?:ya?ml|sh)$/.test(name))
    .map((name) => join(folder, name));
}

const sources = ['.github/workflows', '.github/scripts', '.github/actions'].flatMap(files).map((path) => ({
  path,
  text: readFileSync(join(repositoryRoot, path), 'utf8'),
}));

test('a file that calls Vercel’s API does it through vercel_api, not curl', () => {
  const offenders = sources
    .filter(
      ({ path, text }) => text.includes(VERCEL_API) && CURL_CALL.test(text) && !(path in OWN_STATUS_CHECK),
    )
    .map(({ path }) => path);
  expect(offenders, 'source .github/scripts/vercel-api.sh and call vercel_api').toEqual([]);
});

test('a file that pipes vercel_api sets pipefail, so a refusal stops it', () => {
  const offenders = sources
    .filter(({ text }) => PIPED_HELPER.test(text.replace(/\\\n\s*/g, ' ')) && !text.includes('pipefail'))
    .map(({ path }) => path);
  expect(offenders).toEqual([]);
});

test('every listed exception still exists and still calls curl', () => {
  for (const path of Object.keys(OWN_STATUS_CHECK)) {
    const source = sources.find((candidate) => candidate.path === path);
    expect(source, path).toBeDefined();
    expect(CURL_CALL.test(source?.text ?? ''), path).toBe(true);
  }
});
