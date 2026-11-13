import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'bun:test';

import { showInUnsentWorkHost } from '@/components/shared/unsent-work-host';
import { listProductSources, repositoryRoot } from './product-sources';

// Every flow that ends a session asks about unsent work (components/shared/unsent-work-gate.ts),
// and the question renders into a host (components/shared/unsent-work-host.tsx). The app shell
// mounts one for every page inside it; a page outside it that can ask mounts its own. Without a
// host the ask throws, and the session end stops with an error rather than going on unasked.

/** The modules that open the question: the gate's direct callers and the hooks the flows use. */
const OPENERS = [
  "from '@/components/shared/unsent-work-gate'",
  "from '@/hooks/use-sign-out'",
  "from '@/components/settings/use-password-change-flow'",
];

const HOST = '<UnsentWorkHost';

function text(file: string): string {
  return readFileSync(resolve(repositoryRoot, file), 'utf8');
}

/** Whether a file needs no host of its own: a hook or module renders nothing, and the shell hosts its pages. */
function hostedElsewhere(file: string): boolean {
  if (file.startsWith('hooks/') || file.startsWith('lib/')) return true;
  return (
    file.startsWith('app/(app)/') ||
    (file.startsWith('components/') && !file.startsWith('components/onboarding/'))
  );
}

test('the app shell mounts the unsent-work host for every page inside it', () => {
  expect(text('components/sidebar/app-shell.tsx')).toContain(HOST);
});

test('every flow outside the app shell that can ask about unsent work mounts a host itself', () => {
  const openers = listProductSources().filter((file) =>
    OPENERS.some((opener) => text(file).includes(opener)),
  );
  const outside = openers.filter((file) => !hostedElsewhere(file));
  expect(outside.length).toBeGreaterThan(0);
  expect(outside.filter((file) => !text(file).includes(HOST))).toEqual([]);
});

test('no layout mounts the host: a client reference there would ride in every route payload', () => {
  const layouts = listProductSources(['app']).filter((file) => /\/layout\.tsx$/.test(file));
  expect(layouts.filter((file) => text(file).includes(HOST))).toEqual([]);
});

test('asking without a mounted host throws, so the session end stops with its error instead of going on unasked', () => {
  expect(() => showInUnsentWorkHost(null)).toThrow('no unsent-work host is mounted');
});
