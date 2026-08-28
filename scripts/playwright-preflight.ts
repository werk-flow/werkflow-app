import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { PLAYWRIGHT_LANES, type PlaywrightLane } from '../lib/testing/run-policy';
import { loadEnvLocal, requireEnv } from '../tests/golden/support/env';
import { listRetainedWorlds } from '../tests/golden/support/run-state';

const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';
const DEV_BUCKET = 'werkflow-documents-dev';

type ListenerDetails = {
  processId: number;
  commandLine: string | null;
  creationDate: string;
};

function assertDevRouting(): void {
  loadEnvLocal();
  const projectRef = new URL(requireEnv('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0];
  if (projectRef !== DEV_PROJECT_REF) {
    throw new Error(`Playwright requires DEV Supabase ${DEV_PROJECT_REF}; found ${projectRef}.`);
  }
  const bucket = requireEnv('R2_BUCKET_NAME');
  if (bucket !== DEV_BUCKET) {
    throw new Error(`Playwright requires R2 bucket ${DEV_BUCKET}; found ${bucket}.`);
  }
}

async function assertDevSupabaseReachable(): Promise<void> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const publishableKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  let lastFailure = 'unknown failure';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < 3) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
  }

  throw new Error(
    `DEV Supabase was unreachable in three bounded attempts (${lastFailure}). Do not start Playwright while its authoritative backend is unavailable.`
  );
}

async function assertDevR2Reachable(): Promise<void> {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  const jurisdiction = process.env.R2_JURISDICTION ?? 'eu';
  const jurisdictionSegment = jurisdiction ? `${jurisdiction}.` : '';
  const endpoint = new URL(
    `https://${accountId}.${jurisdictionSegment}r2.cloudflarestorage.com`
  );
  let lastFailure = 'unknown failure';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      // Authentication errors are expected without a signed request. Any HTTP
      // response proves the endpoint completed a network round trip.
      return;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < 3) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
  }

  throw new Error(
    `DEV R2 was unreachable in three bounded attempts (${lastFailure}). Do not start Playwright while direct uploads cannot reach their authoritative store.`
  );
}

function getWindowsListener(): ListenerDetails {
  const script = [
    "$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1",
    "if (-not $listener) { Write-Output 'NO_LISTENER'; exit 0 }",
    "$process = Get-CimInstance Win32_Process -Filter \"ProcessId = $($listener.OwningProcess)\"",
    "$started = (Get-Process -Id $listener.OwningProcess).StartTime.ToUniversalTime().ToString('o')",
    "[pscustomobject]@{ processId = $listener.OwningProcess; commandLine = $process.CommandLine; creationDate = $started } | ConvertTo-Json -Compress",
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
  });
  if (result.error) {
    throw new Error(`Could not inspect port 3000: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not inspect port 3000: ${result.stderr.trim() || `PowerShell exited ${result.status}`}`
    );
  }
  const output = result.stdout.trim();
  // An empty port is an expected pre-run state, not an inspection failure —
  // the vague "Could not inspect" wording cost the P1-17 cycle a confused
  // diagnosis moment (incident log, 2026-08-28).
  if (!output || output === 'NO_LISTENER') {
    throw new Error(
      'Certification requires a freshly built, workspace-owned `next start` listening on port 3000. Nothing is listening — start the server after `bun run build` (testing rules 7 and 11).'
    );
  }
  try {
    return JSON.parse(output) as ListenerDetails;
  } catch {
    throw new Error(`Port-3000 inspection returned invalid JSON: ${output.slice(0, 200)}`);
  }
}

async function assertCertificationServer(repositoryRoot: string): Promise<void> {
  const buildIdPath = resolve(repositoryRoot, '.next/BUILD_ID');
  if (!existsSync(buildIdPath)) throw new Error('Certification requires a fresh production build.');
  const buildId = readFileSync(buildIdPath, 'utf8').trim();
  if (!buildId) throw new Error('.next/BUILD_ID is empty.');

  if (process.platform !== 'win32') {
    throw new Error(
      `Certification server ownership verification is not implemented for ${process.platform}.`
    );
  }
  const listener = getWindowsListener();
  // CommandLine is null for processes this user cannot inspect (elevated or
  // protected) — refuse with a directive message instead of a TypeError.
  if (!listener.commandLine) {
    throw new Error(
      `Port 3000 PID ${listener.processId} has no inspectable command line (elevated or protected process). Stop it and start the server from this workspace.`
    );
  }
  const commandLine = listener.commandLine.toLowerCase();
  if (!commandLine.includes('next') || !commandLine.includes('werkflow-app')) {
    throw new Error(
      `Port 3000 PID ${listener.processId} is not a verified WerkFlow Next.js process.`
    );
  }
  const listenerStartedAt = Date.parse(listener.creationDate);
  if (!Number.isFinite(listenerStartedAt) || listenerStartedAt < statSync(buildIdPath).mtimeMs) {
    throw new Error(
      `Port 3000 PID ${listener.processId} started before build ${buildId}. Restart it from this workspace.`
    );
  }

  let response: Response;
  try {
    response = await fetch('http://localhost:3000/login', {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(
      `Workspace server health check failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!response.ok) throw new Error(`Workspace server health check returned HTTP ${response.status}.`);
}

export async function runPlaywrightPreflight(input: {
  lane: PlaywrightLane;
  repositoryRoot?: string;
}): Promise<void> {
  const repositoryRoot = input.repositoryRoot ?? resolve(import.meta.dir, '..');
  assertDevRouting();
  await assertDevSupabaseReachable();
  await assertDevR2Reachable();
  if (input.lane !== 'certification') return;
  const retainedWorlds = listRetainedWorlds();
  if (retainedWorlds.length > 0) {
    throw new Error(
      `Certification requires zero retained worlds; clean ${retainedWorlds.length} retained world(s) first.`
    );
  }
  await assertCertificationServer(repositoryRoot);
}

if (import.meta.main) {
  try {
    const argument = process.argv[2] ?? 'iteration';
    if (!PLAYWRIGHT_LANES.includes(argument as PlaywrightLane)) {
      throw new Error(
        `Unknown lane: ${argument}. Expected one of ${PLAYWRIGHT_LANES.join(', ')}.`
      );
    }
    const lane = argument as PlaywrightLane;
    await runPlaywrightPreflight({ lane });
    console.log(`[werkflow-test] ${lane} preflight passed`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
