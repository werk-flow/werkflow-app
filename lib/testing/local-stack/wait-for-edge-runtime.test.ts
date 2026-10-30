import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The CI wait for the local edge runtime (.github/actions/local-stack/wait-for-edge-runtime.sh),
// run against stand-in docker, curl and sleep commands: a stopped runtime is started once, and a
// start that fails ends the wait at once with its own error and the evidence.
const script = resolve(import.meta.dir, '../../../.github/actions/local-stack/wait-for-edge-runtime.sh');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** Runs the wait with stand-ins; `startWorks` decides whether `docker start` succeeds. */
function runWait(startWorks: boolean): {
  status: number | null;
  output: string;
  started: boolean;
  requests: number;
} {
  const bin = mkdtempSync(join(tmpdir(), 'werkflow-edge-wait-'));
  directories.push(bin);
  const started = join(bin, 'started');
  const requests = join(bin, 'requests');
  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub(
    'curl',
    `echo >> '${requests}'; if test -e '${started}'; then printf '204 0.050000s'; else printf '503 0.001000s'; fi`,
  );
  stub(
    'docker',
    [
      'case "$1" in',
      `  inspect) if test -e '${started}'; then running=true; else running=false; fi`,
      '    case "$3" in',
      '      \'{{.State.Running}}\') echo "$running" ;;',
      '      *) echo "Runtime container: running=$running exit=137 oom_killed=true" ;;',
      '    esac ;;',
      `  start) ${startWorks ? `touch '${started}'` : 'echo "start refused" >&2; exit 1'} ;;`,
      '  logs) echo "log of $*" ;;',
      '  stats) echo "stats of the stack" ;;',
      'esac',
    ].join('\n'),
  );
  stub('sleep', 'exit 0');
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    started: existsSync(started),
    requests: existsSync(requests) ? readFileSync(requests, 'utf8').split('\n').length - 1 : 0,
  };
}

test('a stopped runtime is started once and the wait then answers 204', () => {
  const { status, output, started, requests } = runWait(true);
  expect(status).toBe(0);
  expect(started).toBe(true);
  expect(requests).toBe(2);
  expect(output).toContain('The edge runtime exited after');
  expect(output).toContain('oom_killed=true');
  expect(output).toContain('started the stopped runtime');
  expect(output).toContain('The edge runtime answered 204');
});

test('a start that fails ends the wait at once with its own error, the state and both logs', () => {
  const { status, output, started, requests } = runWait(false);
  expect(status).toBe(1);
  expect(started).toBe(false);
  // One request before the failed start, none after: the wait does not poll on.
  expect(requests).toBe(1);
  expect(output).toContain('docker start could not start it again');
  expect(output).not.toContain('within 180 s');
  expect(output).toContain('could not start the stopped runtime');
  expect(output).toContain('oom_killed=true');
  expect(output).toContain('log of logs --timestamps --tail 40 supabase_kong_werkflow-app');
});
