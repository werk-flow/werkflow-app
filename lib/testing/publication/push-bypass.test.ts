// Rule test: an agent shell command that would push past the publication gate or switch it off is named.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { publicationBypass } from './push-bypass';

test('pushes past the gate and switched-off hooks are named', () => {
  for (const command of [
    'git push --no-verify origin main:partner-preview',
    'git push origin main:partner-preview --no-verify',
    'cd repo && git push -q --no-verify',
    'git push --no-v origin x',
    'git push --no-veri origin x',
    'git -c core.hooksPath= push origin main',
    'git -c core.hooksPath=/dev/null push',
    'git -c "core.hooksPath=" push',
    'git --config-env=core.hooksPath=EMPTY push',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0= git push',
    '$env:GIT_CONFIG_PARAMETERS = "\'core.hooksPath=\'"; git push',
    'git config core.hooksPath .git/hooks',
    'git config --unset core.hooksPath',
    'git config --local core.hooksPath ""',
    // A --get later in the arguments is no read.
    'git config core.hooksPath /tmp/none --get',
  ])
    expect(publicationBypass(command)).toBeString();
});

test('ordinary pushes, the sanctioned setup and reading the setting are not', () => {
  for (const command of [
    'git push origin main:partner-preview',
    'git push -n origin main:partner-preview',
    'git config core.hooksPath .githooks',
    'git config --get core.hooksPath',
    'git log --grep no-verify',
    'grep -n "core.hooksPath" .githooks/pre-push',
    'bun run test:verify',
  ])
    expect(publicationBypass(command)).toBeUndefined();
});

test('the prepared agent hook refuses a bypass and lets other calls through', () => {
  const script = resolve(import.meta.dir, '../../../.claude/hooks/refuse-publication-bypass.ts');
  const call = (command: string) =>
    Bun.spawnSync({
      cmd: [process.execPath, script],
      stdin: Buffer.from(JSON.stringify({ tool_name: 'Bash', tool_input: { command } })),
      stdout: 'pipe',
      stderr: 'pipe',
    });
  const refused = call('git push --no-verify origin main:partner-preview');
  expect(refused.exitCode).toBe(2);
  expect(refused.stderr.toString()).toContain('--no-verify');
  expect(call('git push origin main:partner-preview').exitCode).toBe(0);
});
