// The service worker the app serves at /sw.js: the source in
// lib/offline/service-worker.js behind one line that names the build's shell
// version. next.config.ts composes it at every build and inlines it into
// app/sw.js/route.ts, so no release can serve a new shell under an old
// version, and nobody edits a number by hand.
//
// next.config.ts loads this module before the build without the `@/` alias,
// so it imports only Node built-ins.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type BuildEnvironment = Readonly<Record<string, string | undefined>>;

/** Next's phase name for `next build` (`PHASE_PRODUCTION_BUILD` in next/constants). */
const PRODUCTION_BUILD_PHASE = 'phase-production-build';

/** Outside a production build no worker registers (components/sidebar/app-shell.tsx). */
const DEVELOPMENT_VERSION = 'development';

/** A version becomes part of a cache name and a JavaScript string. */
const VERSION_SHAPE = /^[\w-]{1,64}$/;

/**
 * The shell version of this build. A local production build (scripts/build.ts:
 * the test server and CI) has its recorded build id; a Vercel build has its
 * commit (`VERCEL_GIT_COMMIT_SHA`, a system variable Vercel sets at build
 * time). A production build with neither fails, so it cannot ship a shell
 * under a version an earlier build used.
 */
function shellVersion(phase: string, env: BuildEnvironment): string {
  const id = env.WERKFLOW_BUILD_ID || env.VERCEL_GIT_COMMIT_SHA;
  if (!id) {
    if (phase === PRODUCTION_BUILD_PHASE)
      throw new Error(
        'A production build needs WERKFLOW_BUILD_ID (bun run build) or VERCEL_GIT_COMMIT_SHA (Vercel) for the service worker shell version.',
      );
    return DEVELOPMENT_VERSION;
  }
  if (!VERSION_SHAPE.test(id))
    throw new Error(
      'The build id for the service worker shell version must be 1 to 64 letters, digits, _ or -.',
    );
  return id;
}

/**
 * The worker script a build in `phase` with `env` serves. `phase` is Next's
 * phase name; next.config.ts passes its own, a test passes the build phase.
 */
export function serviceWorkerScript(repositoryRoot: string, phase: string, env: BuildEnvironment): string {
  const version = shellVersion(phase, env);
  const source = readFileSync(join(repositoryRoot, 'lib', 'offline', 'service-worker.js'), 'utf8');
  return `const SHELL_VERSION = ${JSON.stringify(version)};\n${source}`;
}
