// No credential enters a job container of the owner's machines (container-slot.ts): the job's
// environment is an allowlist, a token-shaped value fails the job, the docker command names nothing
// of the runner's environment, and the slot's commands run without the runner's variables.
import { expect, test } from 'bun:test';
import { slotEnvironment } from '../../../scripts/ci/container-executor';
import {
  jobCommand,
  jobEnvironment,
  otherGenerations,
  type SlotConfig,
  stageCommand,
} from './container-slot';

const SLOT: SlotConfig = {
  prefix: ['wsl.exe', '-d', 'werkflow-ci', '-u', 'cirunner', '--'],
  dockerHost: 'unix:///run/user/1002/docker.sock',
  socket: '/run/user/1002/docker.sock',
  root: '/home/cirunner/ci',
  image: 'werkflow-ci:abc',
  containerUser: 'root',
};
const TOKEN = `ghp_${'x'.repeat(36)}`;
const WORKSPACE = '/home/cirunner/ci/runs/0123456789abcdef-1/fast';
const START = { jobStartedAt: '2026-11-23T02:00:00.000Z', machineStart: true };

test("a job container's environment is the allowlist: the runner's tokens never pass", () => {
  const environment = jobEnvironment(
    {
      unit: { job: 'fast', shard: null },
      env: {
        CI_EVENT: 'pr',
        CI_RUN_URL: 'https://github.com/werk-flow/werkflow-app/commit/abc#run',
        GITHUB_REPOSITORY: 'werk-flow/werkflow-app',
        GH_TOKEN: TOKEN,
        GITHUB_TOKEN: TOKEN,
        CI_JOB_GH_TOKEN: TOKEN,
        SIBLING_REPOSITORIES_TOKEN: TOKEN,
        CI_CHECK_APP_TOKEN: TOKEN,
        CI_LEDGER: '/state/ledger.jsonl',
        CI_PUBLISHER: '/trusted/publish',
      },
    },
    WORKSPACE,
    START,
  );
  for (const name of [
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'CI_JOB_GH_TOKEN',
    'SIBLING_REPOSITORIES_TOKEN',
    'CI_CHECK_APP_TOKEN',
    'CI_LEDGER',
    'CI_PUBLISHER',
  ])
    expect(environment).not.toHaveProperty(name);
  expect(environment.CI_EVENT).toBe('pr');
  expect(environment.CI_RESULTS_DIR).toBe(`${WORKSPACE}/results`);
  expect(environment.WERKFLOW_GITHUB_SNAPSHOT).toBe(`${WORKSPACE}/github-snapshot.json`);
});

test('a token-shaped value under an allowed name fails the job instead of entering it', () => {
  expect(() =>
    jobEnvironment(
      { unit: { job: 'plan', shard: null }, env: { CI_FULL_REASON: `see ${TOKEN}` } },
      WORKSPACE,
      START,
    ),
  ).toThrow('CI_FULL_REASON holds a credential');
});

test("the job's docker command mounts only its workspace, the socket and the caches, and names no token", () => {
  const environment = jobEnvironment(
    { unit: { job: 'sql', shard: null }, env: { CI_EVENT: 'pr' } },
    WORKSPACE,
    START,
  );
  const command = jobCommand(SLOT, {
    name: 'werkflow-ci-x-sql',
    generation: 3,
    workspace: WORKSPACE,
    environment,
    unit: { job: 'sql', shard: null },
  });
  expect(command.slice(0, 3)).toEqual(['env', 'DOCKER_HOST=unix:///run/user/1002/docker.sock', 'docker']);
  const volumes = command.flatMap((argument, index) => (command[index - 1] === '--volume' ? [argument] : []));
  expect(volumes).toEqual([
    '/run/user/1002/docker.sock:/var/run/docker.sock',
    `${WORKSPACE}:${WORKSPACE}`,
    '/home/cirunner/ci/git/werkflow-app.git:/home/cirunner/ci/git/werkflow-app.git:ro',
    'werkflow-ci-bun-cache:/home/runner/.bun/install/cache',
    'werkflow-ci-playwright-cache:/home/runner/.cache/ms-playwright',
  ]);
  expect(command.join(' ')).not.toMatch(/TOKEN|ghp_/);
  expect(command).toContain('org.werkflow.ci-generation=3');
  expect(command.slice(-2)).toEqual(['werkflow-ci-job', 'sql']);
  expect(
    stageCommand(SLOT, {
      workspace: WORKSPACE,
      commit: 'a'.repeat(40),
      repository: 'werk-flow/werkflow-app',
    }).join(' '),
  ).not.toMatch(/TOKEN|ghp_/);
});

test("the slot's commands run without the runner's variables, and WSL forwards none", () => {
  const environment = slotEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/agent',
    WSL_INTEROP: '/run/WSL/1_interop',
    GH_TOKEN: TOKEN,
    SIBLING_REPOSITORIES_TOKEN: TOKEN,
    WSLENV: 'GH_TOKEN/u',
  });
  expect(environment).toEqual({
    WSLENV: '',
    PATH: '/usr/bin',
    HOME: '/home/agent',
    WSL_INTEROP: '/run/WSL/1_interop',
  });
});

test('a restart stops exactly the job containers of other generations', () => {
  expect(otherGenerations('werkflow-ci-a-fast 2\nwerkflow-ci-b-plan 3\n\n', 3)).toEqual([
    'werkflow-ci-a-fast',
  ]);
});
