import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CI_JOBS,
  CI_TOOLS,
  PREPARE_STEPS,
  partOf,
  partSteps,
  type PrepareStep,
} from '../../lib/testing/ci/dag';

// The environment a CI job takes before its body, the same on every runner (lib/testing/ci/dag.ts
// names each job's steps). On GitHub Actions the composites of .github/actions call one step at a
// time between GitHub's caches; scripts/ci/run-commit.ts runs a job's whole list with `for <job>`.
// It acts on the checkout in the current directory, and imports nothing outside Node's modules and
// lib/testing/ci/dag.ts, so `install` runs before the dependencies exist.
// Usage: bun scripts/ci/prepare.ts <install|siblings|approval|stack-environment|stack|env|playwright|playwright-packages>
//        bun scripts/ci/prepare.ts for <job>
// It reads plain environment variables only:
//   GITHUB_ENV     A file. A step that sets a variable for the job body appends `KEY=value` to it:
//                  GitHub Actions reads it, and another runner gives each job a file of its own and
//                  passes its lines to the body. Without it, nothing is passed on.
//   GITHUB_OUTPUT  playwright: `missing` and `key` of Chromium's system packages, for the cache.
//   CI_EVENT, CI_PRS, CI_BASE_SHA, GITHUB_REPOSITORY  approval (scripts/ci/job.ts names them).
//   SIBLING_REPOSITORIES_TOKEN  siblings: reads the private werkflow-business. Without it the clone
//                  is left out and docs:check says so. Only the clone sees it, never the job body. A
//                  runner off GitHub runs this step from its trusted copy before the job's own steps,
//                  which then find the clones and skip it.
//   CI_CHECKOUT    The checkout to act on, when the step runs from another directory: a trusted step
//                  runs outside the tested checkout, whose bunfig.toml and .env files Bun would load.
//   CI_CACHE_DIR   Off GitHub Actions, optional: a folder the runner keeps across jobs for the
//                  stack's environment and Chromium's system packages, in place of GitHub's caches.
//   CI_REPLACE_STACK=1  stack: stops a running stack of the project first, its volumes included.
//                  Set it only on a host whose Docker serves CI alone; without it a running stack
//                  fails the step, so a job never tests against another job's schema.
//   MISSING, DEBS  playwright-packages on GitHub Actions: the packages `playwright` found missing,
//                  and the folder of their cached .deb files.
//   CI_PART        for: the part of the job on the CI mirror (lib/testing/ci/dag.ts, partSteps).
//                  `tree` leaves out the steps that read outside the tree, `host` takes only those
//                  and the install. Unset: every step of the job.

const PROJECT_LABEL = 'com.supabase.cli.project=werkflow-app';
const STACK_NETWORK = 'supabase_network_werkflow-app';
/** The stack's ports, 54321 to 54327, must sit outside the range outgoing connections take. */
const STACK_PORTS = { low: 54321, high: 54327 };
const STACK_ENVIRONMENT = '.env.local-stack-backup';
const SIBLINGS = { website: 'werkflow-website', business: 'werkflow-business' } as const;
const actions = process.env.GITHUB_ACTIONS === 'true';
/** The checkout: the current directory, or CI_CHECKOUT for a trusted step run from outside it. */
const checkout = resolve(process.env.CI_CHECKOUT || process.cwd());

function fail(message: string): never {
  console.error(`::error title=Prepare::${message}`);
  process.exit(1);
}

/** Runs a command in `cwd`, the checkout by default, with its output shown; a failure ends the step. */
function sh(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
  cwd = checkout,
): void {
  const ran = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (ran.status !== 0)
    fail(`${command} ${args.join(' ')} ended with ${ran.error?.message ?? ran.signal ?? ran.status}.`);
}

/** A command's trimmed output, or undefined when it failed. */
function read(command: string, args: readonly string[]): string | undefined {
  const ran = spawnSync(command, args, {
    cwd: checkout,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return ran.status === 0 ? ran.stdout.trim() : undefined;
}

/** Passes a variable to the job body. */
function exportVariable(name: string, value: string): void {
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
}

function install(): void {
  if (Bun.version !== CI_TOOLS.bun) fail(`Bun ${Bun.version} runs here; CI pins ${CI_TOOLS.bun}.`);
  const node = read('node', ['--version']);
  if (!node?.startsWith(`v${CI_TOOLS.nodeMajor}.`))
    fail(`Node ${node ?? 'is missing'} runs here; CI pins Node ${CI_TOOLS.nodeMajor}.`);
  sh(process.execPath, ['install', '--frozen-lockfile']);
}

/** The clones docs:check reads beside the checkout (docs/README.md, "Sibling repositories"). */
function siblings(): void {
  const parent = resolve(checkout, '..');
  // scripts/ci/process-executor.ts clones them first with the trusted copy of this step, and ci.yml
  // with an inline step, so the tested commit's steps never hold the token: each clone in place is
  // kept, each missing one made. git runs beside the checkout, never in it, so no configuration of
  // the tested checkout reaches the process that holds the token.
  if (!existsSync(join(parent, SIBLINGS.website)))
    sh(
      'git',
      [
        'clone',
        '--quiet',
        '--depth',
        '1',
        `https://github.com/werk-flow/${SIBLINGS.website}`,
        join(parent, SIBLINGS.website),
      ],
      {},
      parent,
    );
  if (existsSync(join(parent, SIBLINGS.business))) return;
  const token = process.env.SIBLING_REPOSITORIES_TOKEN;
  if (!token) {
    console.info(
      '::warning::SIBLING_REPOSITORIES_TOKEN is not set, so docs:check cannot read the private werkflow-business clone.',
    );
    exportVariable('WERKFLOW_UNREADABLE_SIBLINGS', SIBLINGS.business);
    return;
  }
  // The token reaches git as configuration from the environment: not in the arguments, and not in the
  // clone's .git/config, which the job body could read.
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  sh(
    'git',
    [
      'clone',
      '--quiet',
      '--depth',
      '1',
      `https://github.com/werk-flow/${SIBLINGS.business}`,
      join(parent, SIBLINGS.business),
    ],
    {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: header,
    },
    parent,
  );
}

/**
 * The owner's approval for a shrink-only list to grow (docs/technical/testing.md, "Grow a shrink-only
 * list"), read now, so a rerun after a label change sees it. A pull request run takes its own PR's
 * label. An integration run takes every PR it serves: CI_PRS, and each squash commit "<title> (#<n>)"
 * above its base. Each PR's own Check already held its growth to its label, so one approval covers them.
 */
async function approval(): Promise<void> {
  const event = process.env.CI_EVENT;
  if (event !== 'pr' && event !== 'integration') return;
  // After `install`: the parser needs the dependencies.
  const { pullRequestsOf } = await import('../../lib/testing/ci/measurement');
  const named = pullRequestsOf(process.env.CI_PRS);
  if ('unreadable' in named) fail(named.unreadable);
  const squashed =
    event === 'integration' && process.env.CI_BASE_SHA
      ? (
          read('git', ['log', '--format=%s', `${process.env.CI_BASE_SHA}..HEAD`]) ??
          fail('The queue commits cannot be read.')
        )
          .split('\n')
          .flatMap((subject) => /\(#([0-9]+)\)$/.exec(subject)?.[1] ?? [])
          .map(Number)
      : [];
  const repository = process.env.GITHUB_REPOSITORY;
  let approved = false;
  for (const pr of [...new Set([...named, ...squashed])].sort((left, right) => left - right)) {
    if (!repository) fail('The approval needs GITHUB_REPOSITORY.');
    const labels = read('gh', [
      'api',
      '--paginate',
      `repos/${repository}/issues/${pr}/labels`,
      '--jq',
      '.[].name',
    ]);
    if (labels === undefined) fail(`The labels of #${pr} cannot be read.`);
    if (labels.split('\n').includes('approved: list growth')) approved = true;
  }
  exportVariable('SHRINK_ONLY_GROWTH_APPROVED', String(approved));
  console.info(`approved: list growth = ${approved}`);
}

/** The cached copy of the stack's environment: it depends only on the CLI version and config.toml. */
function cachedEnvironment(): string | undefined {
  const cache = process.env.CI_CACHE_DIR;
  if (!cache) return undefined;
  const config = createHash('sha256')
    .update(readFileSync(join(checkout, 'supabase/config.toml')))
    .digest('hex');
  return join(cache, `supabase-environment-v1-${CI_TOOLS.supabaseCli}-${config}`);
}

/** The stack's environment file; the stack starts only when neither the checkout nor the cache holds it. */
function stackEnvironment(): void {
  if (existsSync(join(checkout, STACK_ENVIRONMENT))) return;
  const cached = cachedEnvironment();
  if (cached && existsSync(cached)) {
    copyFileSync(cached, join(checkout, STACK_ENVIRONMENT));
    return;
  }
  stack();
}

/** Every container of the project's stack, with its published ports. */
const stackContainers = (): string =>
  read('docker', ['ps', '--filter', `label=${PROJECT_LABEL}`, '--format', '{{.Names}} {{.Ports}}']) ??
  fail('docker cannot list the containers.');

/**
 * A fresh stack at this checkout's migrations, published on loopback only, its edge runtime ready,
 * and its environment recorded.
 */
function stack(): void {
  const cli = read('supabase', ['--version']);
  if (cli !== CI_TOOLS.supabaseCli)
    fail(`Supabase CLI ${cli ?? 'is missing'}; CI pins ${CI_TOOLS.supabaseCli}.`);
  if (stackContainers()) {
    if (process.env.CI_REPLACE_STACK !== '1')
      fail(
        'A stack of the project runs already, so this job would test against another schema. On a host that serves CI alone, set CI_REPLACE_STACK=1.',
      );
    sh('supabase', ['stop', '--no-backup']);
  }
  // The stack's ports sit inside Linux's default ephemeral range, so a new outgoing connection,
  // loopback ones included, could take one. Move the range above them.
  if (process.platform === 'linux') {
    const [low = 0, high = 0] = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8')
      .trim()
      .split(/\s+/)
      .map(Number);
    if (low <= STACK_PORTS.high && high >= STACK_PORTS.low)
      sh('sudo', ['sysctl', '-w', 'net.ipv4.ip_local_port_range=55000 65000']);
  }
  // The runner's own connections can sit on a stack port, and a bind on 0.0.0.0 then fails with
  // "address already in use". Those use the host's network address, so a bind on loopback cannot
  // clash with them, and nothing outside the host reads the stack. The CLI reuses this network.
  const binding = read('docker', [
    'network',
    'inspect',
    STACK_NETWORK,
    '--format',
    '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}',
  ]);
  if (binding !== undefined && binding !== '127.0.0.1') sh('docker', ['network', 'rm', STACK_NETWORK]);
  if (binding !== '127.0.0.1')
    sh('docker', [
      'network',
      'create',
      '--label',
      PROJECT_LABEL,
      '--opt',
      'com.docker.network.bridge.host_binding_ipv4=127.0.0.1',
      STACK_NETWORK,
    ]);
  // Studio and imgproxy serve people, not tests. Every image comes from GitHub's registry: public ECR
  // rate-limits anonymous pulls. The variable stays on the CLI: the build identity fingerprints every
  // SUPABASE_ variable the test runner sees.
  sh('supabase', ['start', '--exclude', 'studio,imgproxy'], { SUPABASE_INTERNAL_IMAGE_REGISTRY: 'ghcr.io' });
  // A runner off GitHub stops only a stack its job started (scripts/ci/process-executor.ts).
  exportVariable('CI_STACK_STARTED', '1');
  // A CLI that names its network differently would ignore the one above and bind every address again,
  // which shows only as a rare failed start. This fails every start instead.
  const everyAddress = stackContainers()
    .split('\n')
    .filter((line) => /(0\.0\.0\.0|\[::\]):/.test(line));
  if (everyAddress.length)
    fail(
      `A stack port is published on every address, so a runner connection can block the next start: ${everyAddress.join('; ')}`,
    );
  // A fresh edge runtime boots its functions after the stack reports ready; the script owns the
  // bounded wait, the one start of an exited runtime, and the evidence it prints.
  sh('bash', [resolve(import.meta.dir, '../../.github/actions/local-stack/wait-for-edge-runtime.sh')]);
  recordEnvironment();
}

/** Writes the stack's URL and keys, the CLI's fixed defaults, for `env`, and keeps a copy in the cache. */
function recordEnvironment(): void {
  const status = read('supabase', ['status', '--output', 'env']) ?? fail('supabase status cannot be read.');
  const values = new Map(
    status.split('\n').flatMap((line) => {
      const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
      return match?.[1] && match[2] !== undefined ? [[match[1], match[2]] as const] : [];
    }),
  );
  const value = (name: string): string => values.get(name) ?? fail(`supabase status names no ${name}.`);
  const text = [
    `NEXT_PUBLIC_SUPABASE_URL=${value('API_URL')}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${value('PUBLISHABLE_KEY')}`,
    `SUPABASE_SECRET_KEY=${value('SECRET_KEY')}`,
    'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
    'R2_ACCOUNT_ID=local',
    `R2_ACCESS_KEY_ID=${value('S3_PROTOCOL_ACCESS_KEY_ID')}`,
    `R2_SECRET_ACCESS_KEY=${value('S3_PROTOCOL_ACCESS_KEY_SECRET')}`,
    'R2_BUCKET_NAME=werkflow-documents-local',
    `R2_ENDPOINT=${value('STORAGE_S3_URL')}`,
    '',
  ].join('\n');
  writeFileSync(join(checkout, STACK_ENVIRONMENT), text);
  const cached = cachedEnvironment();
  if (cached) {
    mkdirSync(resolve(cached, '..'), { recursive: true });
    writeFileSync(cached, text);
  }
}

/**
 * Points .env.local at the stack. The build identity hashes every byte of .env.local, so a random
 * secret there would make each shard's build its own: the app reads its one-time-code secret from
 * the job's environment instead.
 */
function env(): void {
  const secret = randomBytes(32).toString('hex');
  if (actions) console.info(`::add-mask::${secret}`);
  exportVariable('EMAIL_OTP_HASH_SECRET', secret);
  sh(process.execPath, ['run', 'env:local']);
}

const SYSTEM_PACKAGES = resolve(import.meta.dir, '../../.github/actions/playwright/system-packages.sh');

/** The host Chromium at the locked Playwright version, then the system packages it misses (Linux). */
function playwright(): void {
  sh(process.execPath, ['x', 'playwright', 'install', 'chromium']);
  if (process.platform === 'linux') sh('bash', [SYSTEM_PACKAGES, 'find']);
}

/** Installs the packages `playwright` found missing, from DEBS when they are there. */
function playwrightPackages(): void {
  if (process.platform !== 'linux' || !process.env.MISSING) return;
  sh('bash', [SYSTEM_PACKAGES, 'install'], {
    DEBS: process.env.DEBS || join(process.env.CI_CACHE_DIR || tmpdir(), 'playwright-debs'),
  });
}

const steps: Record<PrepareStep, () => void | Promise<void>> = {
  install,
  siblings,
  approval,
  'stack-environment': stackEnvironment,
  stack,
  env,
  playwright,
  'playwright-packages': playwrightPackages,
};

/** A job's steps in order. `playwright`'s `missing` output reaches `playwright-packages` as GitHub's step outputs would. */
async function forJob(job: string | undefined): Promise<void> {
  const name = CI_JOBS.find((candidate) => candidate === job);
  if (!name) fail(`Usage: bun scripts/ci/prepare.ts for <${CI_JOBS.join('|')}>`);
  const folder = mkdtempSync(join(tmpdir(), 'ci-prepare-'));
  const outputs = join(folder, 'output');
  writeFileSync(outputs, '');
  process.env.GITHUB_OUTPUT = outputs;
  let part: ReturnType<typeof partOf>;
  try {
    part = partOf(process.env.CI_PART);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  for (const step of partSteps(name, part)) {
    console.info(`[prepare] ${name}: ${step}`);
    if (step === 'playwright-packages')
      process.env.MISSING = /^missing=(.*)$/m.exec(readFileSync(outputs, 'utf8'))?.[1]?.trim() ?? '';
    await steps[step]();
  }
  rmSync(folder, { recursive: true, force: true });
}

const [command, argument] = process.argv.slice(2);
const step = PREPARE_STEPS.find((candidate) => candidate === command);
if (command === 'for') await forJob(argument);
else if (step && argument === undefined) await steps[step]();
else fail(`Usage: bun scripts/ci/prepare.ts <${PREPARE_STEPS.join('|')}> | for <job>`);
