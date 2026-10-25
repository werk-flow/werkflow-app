import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Visual references and acceptance captures compare pixels, and font
 * rasterization differs between operating systems and font packages. Their
 * browser therefore always runs in Playwright's official image at the
 * repository's Playwright version, on linux/amd64 even on an arm64 Mac, so a
 * workstation, a MacBook and CI render the same pixels. The test runner stays
 * on the host and drives the browser through Playwright's run-server;
 * `exposeNetwork` routes the browser's loopback requests (the app and the
 * local Supabase stack) back through the runner.
 */
const VISUAL_SPEC_DIRECTORY = 'tests/audit/visual/';
const SERVER_PORT = 3333;
const READY_TIMEOUT_MS = 60_000;

const packageSchema = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) });

/** The image pinned to the installed Playwright, so its browser build is the one the client expects. */
export function visualBrowserImage(repositoryRoot: string): string {
  const { version } = packageSchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, 'node_modules/playwright-core/package.json'), 'utf8')),
  );
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}

/**
 * Whether a selection renders in the pinned image: a run of visual specs only.
 * A run that mixes them with other specs is refused, because the other specs
 * measure and must keep the host browser.
 */
export function selectsVisualBrowser(selectedFiles: readonly string[]): boolean {
  const visual = selectedFiles.filter((file) => file.startsWith(VISUAL_SPEC_DIRECTORY));
  if (!visual.length) return false;
  if (visual.length !== selectedFiles.length)
    throw new Error(
      `Visual specs (${VISUAL_SPEC_DIRECTORY}) render in the pinned Playwright image, the other specs on the host. Select them in separate runs.`,
    );
  return true;
}

function docker(args: readonly string[], timeoutMs = 120_000): string {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: timeoutMs }).trim();
}

/** A new machine pulls the large image once; that pull gets its own bound, the start keeps 120 s. */
function ensureImage(image: string): void {
  try {
    docker(['image', 'inspect', '--format', '{{.Id}}', image]);
  } catch {
    // inspect exits 1 for an image this machine has not pulled yet.
    console.info(`[werkflow-test] Pulling ${image} once for the visual captures.`);
    docker(['pull', '--platform', 'linux/amd64', image], 30 * 60_000);
  }
}

/**
 * Starts the pinned browser server and returns the environment that points
 * Playwright at it, with the stop that removes the container by its id.
 */
export async function startVisualBrowser(repositoryRoot: string): Promise<{
  environment: Readonly<Record<string, string>>;
  stop: () => void;
}> {
  const image = visualBrowserImage(repositoryRoot);
  ensureImage(image);
  const containerId = docker([
    'run',
    '--detach',
    '--rm',
    '--init',
    '--ipc=host',
    '--platform',
    'linux/amd64',
    '--publish',
    `127.0.0.1::${SERVER_PORT}`,
    // The client's own playwright-core serves the protocol, so server and client cannot drift.
    '--volume',
    `${resolve(repositoryRoot, 'node_modules/playwright-core')}:/opt/playwright-core:ro`,
    image,
    'node',
    '/opt/playwright-core/cli.js',
    'run-server',
    '--port',
    String(SERVER_PORT),
    '--host',
    '0.0.0.0',
  ]);
  const stop = (): void => {
    try {
      docker(['rm', '--force', containerId]);
    } catch (error) {
      console.error(
        `[werkflow-test] Could not remove the visual browser container ${containerId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  try {
    const published = docker(['port', containerId, `${SERVER_PORT}/tcp`]).split('\n')[0] ?? '';
    const hostPort = /:(\d+)$/.exec(published)?.[1];
    if (!hostPort) throw new Error(`The visual browser container published no port: ${published}`);
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (!docker(['logs', containerId]).includes('Listening on')) {
      if (Date.now() > deadline)
        throw new Error(`The visual browser in ${image} did not start within ${READY_TIMEOUT_MS / 1000} s.`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
    console.info(`[werkflow-test] Visual captures render in ${image}.`);
    return {
      environment: {
        PW_TEST_CONNECT_WS_ENDPOINT: `ws://127.0.0.1:${hostPort}/`,
        PW_TEST_CONNECT_EXPOSE_NETWORK: '<loopback>',
      },
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
