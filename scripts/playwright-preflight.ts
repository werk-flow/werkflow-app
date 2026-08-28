import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PLAYWRIGHT_LANES,
  PLAYWRIGHT_TARGETS,
  type PlaywrightLane,
  type PlaywrightTarget,
} from '../lib/testing/run-policy';
import { getR2Endpoint } from '../lib/storage/r2';
import { loadEnvLocal, requireEnv } from '../tests/golden/support/env';
import { listRetainedWorlds } from '../tests/golden/support/run-state';
import { checkRealtimeParity } from './check-realtime-parity';

const DEV_PROJECT_REF = 'mbkkzuqjbdvzelqvuzcn';
const DEV_BUCKET = 'werkflow-documents-dev';
const LOCAL_BUCKET = 'werkflow-documents-local';
const LOCAL_API_PORT = '54321';
// The local stack lives inside WSL; the harness reaches it via loopback
// forwarding or the WSL VM's private NAT address (see environments.md).
const PRIVATE_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

type ListenerDetails = {
  processId: number;
  commandLine: string | null;
  creationDate: string;
};

function assertRouting(target: PlaywrightTarget): void {
  loadEnvLocal();
  const supabaseUrl = new URL(requireEnv('NEXT_PUBLIC_SUPABASE_URL'));
  const bucket = requireEnv('R2_BUCKET_NAME');
  const storageEndpointOverride = process.env.R2_ENDPOINT?.trim() || null;

  if (target === 'cloud') {
    const projectRef = supabaseUrl.hostname.split('.')[0];
    if (projectRef !== DEV_PROJECT_REF) {
      throw new Error(
        `A cloud-target run requires DEV Supabase ${DEV_PROJECT_REF}; found ${projectRef}. Switch with: bun run env:dev`
      );
    }
    if (bucket !== DEV_BUCKET) {
      throw new Error(`A cloud-target run requires R2 bucket ${DEV_BUCKET}; found ${bucket}.`);
    }
    if (storageEndpointOverride) {
      throw new Error(
        'R2_ENDPOINT is set, so storage traffic would bypass Cloudflare. A cloud-target run must not carry the local storage override. Switch with: bun run env:dev'
      );
    }
    return;
  }

  const looksLocal =
    PRIVATE_HOST_PATTERN.test(supabaseUrl.hostname) && supabaseUrl.port === LOCAL_API_PORT;
  if (!looksLocal) {
    throw new Error(
      `A local-target run requires .env.local to route at the local Supabase stack (private host, port ${LOCAL_API_PORT}); found ${supabaseUrl.origin}. Switch with: bun run env:local`
    );
  }
  if (bucket !== LOCAL_BUCKET) {
    throw new Error(`A local-target run requires storage bucket ${LOCAL_BUCKET}; found ${bucket}.`);
  }
  const expectedStorageEndpoint = `${supabaseUrl.origin}/storage/v1/s3`;
  if (storageEndpointOverride !== expectedStorageEndpoint) {
    throw new Error(
      `A local-target run requires R2_ENDPOINT to be exactly ${expectedStorageEndpoint}; found ${storageEndpointOverride ?? 'nothing'}. Regenerate with: bun run env:local`
    );
  }
}

const LOCAL_REMEDY =
  'Start or repair the local stack: `wsl supabase start` in the repo, then `bun run env:local` (the WSL address changes when WSL restarts; certification additionally needs a rebuild so the baked NEXT_PUBLIC_* values match).';

async function probeBounded(input: {
  label: string;
  attempts: number;
  request: () => Promise<Response>;
  accept: (response: Response) => boolean;
  remedy: string;
}): Promise<void> {
  let lastFailure = 'unknown failure';
  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    try {
      const response = await input.request();
      await response.body?.cancel();
      if (input.accept(response)) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < input.attempts) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
  }
  throw new Error(
    `${input.label} was unreachable in ${input.attempts} bounded attempts (${lastFailure}). ${input.remedy}`
  );
}

async function assertSupabaseReachable(target: PlaywrightTarget): Promise<void> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const publishableKey = requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  await probeBounded({
    label: target === 'local' ? 'The local Supabase stack' : 'DEV Supabase',
    attempts: 3,
    request: () =>
      fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
        headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
        signal: AbortSignal.timeout(15_000),
      }),
    accept: (response) => response.ok,
    remedy:
      target === 'local'
        ? LOCAL_REMEDY
        : 'Do not start Playwright while its authoritative backend is unavailable.',
  });
}

async function assertStorageReachable(target: PlaywrightTarget): Promise<void> {
  // Any HTTP response proves the endpoint completed a network round trip;
  // authentication errors are expected without a signed request.
  await probeBounded({
    label: target === 'local' ? 'The local storage S3 endpoint' : 'DEV R2',
    attempts: 3,
    request: () =>
      fetch(getR2Endpoint(), { method: 'HEAD', signal: AbortSignal.timeout(15_000) }),
    accept: () => true,
    remedy:
      target === 'local'
        ? LOCAL_REMEDY
        : 'Do not start Playwright while direct uploads cannot reach their authoritative store.',
  });
}

async function assertLocalEdgeRuntimeReachable(): Promise<void> {
  // `supabase db reset` restarts the stack but leaves the edge-runtime
  // container stopped (observed on CLI 2.116.0, 2026-08-28). The invite flow
  // calls the send-invite-email function, so a dead runtime fails a battery
  // minutes in with a misleading symptom. An OPTIONS preflight answers 204
  // without invoking the function body.
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  await probeBounded({
    label: 'The local edge-function runtime',
    attempts: 3,
    request: () =>
      fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
        method: 'OPTIONS',
        signal: AbortSignal.timeout(15_000),
      }),
    // The function's own OPTIONS handler answers 204; anything else (404 for
    // an undeployed function, 5xx for a dead runtime) is a real problem.
    accept: (response) => response.status === 204,
    remedy:
      'Restart it with: wsl docker start supabase_edge_runtime_werkflow-app (a `supabase db reset` leaves this container stopped).',
  });
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

// Realtime parity (Stage B, Tier 2): the provider's table list must match
// the local stack's publication and replica-identity state before a battery
// certifies anything about live behavior.
function assertRealtimeParity(): void {
  let problems: string[];
  try {
    problems = checkRealtimeParity();
  } catch (error) {
    throw new Error(
      `Could not inspect the local stack for Realtime parity: ${
        error instanceof Error ? error.message : String(error)
      }. ${LOCAL_REMEDY}`
    );
  }
  if (problems.length > 0) {
    throw new Error(
      ['Realtime parity check failed:', ...problems.map((problem) => `  - ${problem}`)].join('\n')
    );
  }
}

export async function runPlaywrightPreflight(input: {
  lane: PlaywrightLane;
  target: PlaywrightTarget;
  repositoryRoot?: string;
}): Promise<void> {
  const repositoryRoot = input.repositoryRoot ?? resolve(import.meta.dir, '..');
  assertRouting(input.target);
  await assertSupabaseReachable(input.target);
  await assertStorageReachable(input.target);
  if (input.target === 'local') {
    await assertLocalEdgeRuntimeReachable();
    assertRealtimeParity();
  }
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
    const laneArgument = process.argv[2] ?? 'iteration';
    if (!PLAYWRIGHT_LANES.includes(laneArgument as PlaywrightLane)) {
      throw new Error(
        `Unknown lane: ${laneArgument}. Expected one of ${PLAYWRIGHT_LANES.join(', ')}.`
      );
    }
    const targetArgument = process.argv[3] ?? 'local';
    if (!PLAYWRIGHT_TARGETS.includes(targetArgument as PlaywrightTarget)) {
      throw new Error(
        `Unknown target: ${targetArgument}. Expected one of ${PLAYWRIGHT_TARGETS.join(', ')}.`
      );
    }
    const lane = laneArgument as PlaywrightLane;
    const target = targetArgument as PlaywrightTarget;
    await runPlaywrightPreflight({ lane, target });
    console.log(`[werkflow-test] ${lane} preflight passed (target ${target})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
