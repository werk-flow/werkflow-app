import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { serviceWorkerScript } from './service-worker-script';

// Rule test: the offline page opens cold on a phone without signal only if
// every file it loads comes from the worker's shell. A cold start may give the
// worker no sign that the page is its fallback: iOS can stop the worker between
// the navigation and the page's file requests, and `navigator.onLine` can still
// say "online". A deployment (Vercel) also asks for a public image with its
// own query (`?dpl=…`), which the shell stored without it. Either way the file
// went to the dead network, the page never ran its script and the logo broke
// (werk-flow/werkflow-planning#22, the 2026-11-14 iPhone re-test).

const ORIGIN = 'https://app.example';
const root = join(import.meta.dir, '..', '..');
const script = serviceWorkerScript(root, 'phase-production-build', { WERKFLOW_BUILD_ID: 'test-build' });
const SHELL_CACHE = 'werkflow-shell-test-build';

type FetchEventStub = {
  request: Request;
  clientId: string;
  respondWith: (answer: Promise<Response>) => void;
  waitUntil: (work: Promise<unknown>) => void;
};

/** The worker script in a sandbox with one filled shell cache and a network that answers `network`. */
function startWorker(shell: Record<string, string>, network: (request: Request) => Promise<Response>) {
  const listeners = new Map<string, (event: FetchEventStub) => void>();
  const entries = new Map(Object.entries(shell).map(([path, body]) => [new URL(path, ORIGIN).href, body]));
  const caches = {
    match: async (
      request: Request | string,
      options: { cacheName?: string; ignoreSearch?: boolean } = {},
    ) => {
      if (options.cacheName !== undefined && options.cacheName !== SHELL_CACHE) return undefined;
      const url = new URL(typeof request === 'string' ? request : request.url, ORIGIN);
      if (options.ignoreSearch) url.search = '';
      const body = entries.get(url.href);
      return body === undefined ? undefined : new Response(body);
    },
    open: async () => ({ addAll: async () => undefined, put: async () => undefined }),
    keys: async () => [SHELL_CACHE],
    delete: async () => true,
  };
  const self = {
    location: { origin: ORIGIN },
    // The phone reports a network it does not have.
    navigator: { onLine: true },
    registration: {},
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: (event: FetchEventStub) => void) =>
      listeners.set(type, listener),
  };
  runInNewContext(script, { self, caches, fetch: network, Request, Response, URL, Set, Error, Promise });
  const fetchListener = listeners.get('fetch');
  if (!fetchListener) throw new Error('The worker listens to no fetch event.');
  /** Dispatches a request from a page the worker never answered; its answer, or null when it lets it pass. */
  return (path: string): { answer: Promise<Response> | null } => {
    let answer: Promise<Response> | null = null;
    fetchListener({
      request: new Request(new URL(path, ORIGIN)),
      clientId: 'a-client-the-worker-never-answered',
      respondWith: (response) => {
        answer = response;
      },
      waitUntil: () => undefined,
    });
    return { answer };
  };
}

const deadNetwork = (): Promise<Response> => Promise.reject(new TypeError('Load failed'));

describe('without signal the offline page loads every file from the shell, whatever the worker knows of the page', () => {
  test('a build file comes from the shell for a page the worker never answered, on a phone that reports a network', async () => {
    const request = startWorker({ '/_next/static/chunks/app-1a2b.js': 'app code' }, deadNetwork);
    const { answer } = request('/_next/static/chunks/app-1a2b.js');
    expect(await (await answer)?.text()).toBe('app code');
  });

  test("a public image asked for with the deployment's query comes from the shell that stored it without one", async () => {
    const request = startWorker({ '/logo-text-light.svg': '<svg/>' }, deadNetwork);
    const { answer } = request('/logo-text-light.svg?dpl=dpl_79Uh74kbSrXXWYXGGt8LS97FU2RS');
    expect(await (await answer)?.text()).toBe('<svg/>');
  });

  test('a file the shell does not hold goes to the network, and fails there without signal', async () => {
    const request = startWorker({ '/_next/static/chunks/app-1a2b.js': 'app code' }, deadNetwork);
    const { answer } = request('/_next/static/chunks/lazy-9z8y.js');
    const outcome =
      answer === null
        ? 'passed to the network'
        : await answer.then(
            () => 'answered',
            () => 'failed',
          );
    expect(outcome).not.toBe('answered');
  });

  test('only shell paths are answered: the offline page, a page and an API read pass to the network untouched', async () => {
    const request = startWorker({ '/offline': 'offline page' }, deadNetwork);
    for (const path of ['/offline?_rsc=1a2b', '/dashboard?_rsc=1a2b', '/api/field-sync/v1/today'])
      expect(request(path).answer, path).toBeNull();
  });
});
