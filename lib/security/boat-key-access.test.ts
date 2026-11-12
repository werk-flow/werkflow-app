// Rule test: no agent call reads, prints or searches the workstation's Boat API key or the Boat
// CLI's config; only the process that calls Boat reads the key.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { boatKeyCommandRefusal, boatKeyToolRefusal, shellFolder } from './boat-key-access';

const home = '/home/agent';
const context = { cwd: '/home/agent/code/werkflow-app', home };
const refused = (command: string, cwd = context.cwd) => boatKeyCommandRefusal(command, { cwd, home });

test('a command that names the key file or the CLI config in any spelling is refused', () => {
  for (const command of [
    'cat ~/.config/werkflow/boat-api-key',
    'head -c 8 "$HOME/.config/werkflow/boat-api-key"',
    'grep boat_ /home/agent/.config/werkflow/boat-api-key',
    'xxd ${HOME}/.config/werkflow/boat-api-key | head',
    'cd ~/.config/werkflow && cat boat-api-key',
    'K=$(cat ~/.config/werkflow/boat-api-key) curl -H "Authorization: Bearer $K" https://boat.dev/api/v1/me',
    'bash -c "cat ~/.config/werkflow/boat-api-key"',
    'cat ~/.config/werkflow/boat-api-key*',
    'cat ~/.config/werkflow/boat-api-key.expires.bak',
    'jq .token ~/.config/ascii/boat/config.json',
    'cd ~/.config/ascii && cat boat/config.json',
    'cat <<EOF | sh\ncat ~/.config/werkflow/boat-api-key\nEOF',
  ])
    expect(refused(command), command).toContain('Boat API key');
});

test('a glob that matches a secret file is refused', () => {
  for (const command of [
    'cat ~/.config/werkflow/*',
    'head ~/.config/werkflow/boat-api-*',
    'cat ~/.config/ascii/*/config.json',
    'cat $HOME/.config/*/boat/*.json',
    'cd ~/.config/werkflow; tail -n1 *',
    'cat ../../.config/werkflow/b*',
  ])
    expect(refused(command), command).toContain('matches a file that holds a Boat API key');
});

test('a recursive read of a folder that holds a secret file is refused', () => {
  for (const command of [
    'grep -r boat_ ~/.config',
    'grep -Rn token ~',
    'grep --recursive token ~/.config/werkflow',
    'rg --hidden boat_ ~/.config',
    'cd ~ && rg -uu token',
    'tar czf /tmp/config.tgz ~/.config',
    'cp -r ~/.config/ascii /tmp/copy',
    'rsync -a ~/ backup:/home',
    'find ~/.config -type f -exec cat {} +',
    'find ~/.config -type f | xargs cat',
    // A glob's literal folder is what a recursive reader reads.
    'grep -R token ~/.config/*',
    'rg --hidden token ~/.config/*',
    // Launchers and shell scripts run the reader all the same.
    'env rg --hidden token ~/.config',
    'timeout 30 nice -n 5 grep -r token ~/.config',
    'bash -lc "rg --hidden token ~/.config"',
    // An existing file named as the pattern leaves the working folder as the searched path.
    'cd ~ && rg -uu .bashrc',
  ])
    expect(refused(command), command).toMatch(/would read every file under/);
});

test('a relative path from the folder of a secret file is refused', () => {
  expect(refused('cat config.json', '/home/agent/.config/ascii/boat')).toContain('names a file');
  expect(refused('head -c 9 ./config.json', '/home/agent/.config/ascii/boat')).toContain('names a file');
  expect(refused('cat ../ascii/boat/config.json', '/home/agent/.config/werkflow')).toContain('names a file');
  // Chained folder changes are followed, and an input redirection reads its file.
  expect(refused('cd ~/.config/ascii && cd boat && cat config.json')).toContain('names a file');
  expect(refused('cat < config.json', '/home/agent/.config/ascii/boat')).toContain('names a file');
  expect(refused('jq . < ./config.json', '/home/agent/.config/ascii/boat')).toContain('names a file');
});

test('a recursive read keeps the folder it runs in through launchers and nested shells', () => {
  for (const command of [
    'env -C ~ rg --hidden token .config',
    'cd ~ && bash -c "rg --hidden token .config"',
    // An attached pattern option leaves the folder operand a folder.
    'rg --hidden -etoken ~/.config',
    'grep -r -etoken ~/.config',
    'grep -d recurse token ~/.config',
    // A file list from find, consumed by a substitution or a pipe.
    'cat $(find ~/.config -name config.json)',
    'head -n 20 `find ~/.config -type f`',
    'find ~/.config -type f | while read f; do head "$f"; done',
    'while IFS= read -r f; do head -n 20 "$f"; done < <(find ~/.config -type f)',
    'grep --directories recurse token ~/.config',
    // A value flag the guard does not know cannot hide the folder it runs in.
    'cd ~ && rg --hidden --sort path token',
  ])
    expect(refused(command), command).toMatch(/would read every file under/);
});

test('ordinary work, the expiry file and the runner pass', () => {
  for (const command of [
    'cat ~/.config/werkflow/boat-api-key.expires',
    'ls -la ~/.config/werkflow',
    'mkdir -p ~/.config/werkflow',
    'bun run test:verify',
    'env WERKFLOW_VERIFY_LOCAL=1 bun run test:verify --group sql:security',
    'timeout 600 bun test lib/security',
    'grep -rn boatKeyCommandRefusal lib/',
    "rg -g '*.ts' --hidden token lib",
    'rg --hidden token .',
    'find ~/.config -name "*.toml"',
    'cp -r .agent-logs ~/scratch/evidence',
    'tar czf out.tgz -C repo .agent-logs',
    'git commit -F ~/scratch/message.txt',
    'bash -lc "rg token lib"',
  ])
    expect(refused(command), command).toBeUndefined();
});

// Covers a payload that names `workdir`. Codex 0.164 to 0.167 send none (codex-rs exec_command.rs,
// pre_tool_use_payload): their calls resolve from the session's folder, and a call run in a key
// folder is deliberate evasion, outside the threat model (docs/technical/security.md).
test('a payload that names its workdir resolves relative paths and globs from it', () => {
  const folder = shellFolder({ command: 'cat b*', workdir: '~/.config/werkflow' }, context);
  expect(folder).toBe('/home/agent/.config/werkflow');
  expect(boatKeyCommandRefusal('cat b*', { cwd: folder, home })).toContain('matches a file');
  expect(shellFolder({ command: 'ls', workdir: '../other' }, context)).toBe('/home/agent/code/other');
  expect(shellFolder({ command: 'ls' }, context)).toBe(context.cwd);
});

test('a long chain of folder changes stays bounded and refuses past the bound', () => {
  // Repeated changes between two folders keep the set small; distinct ones grow it, so the guard stops.
  expect(refused(Array.from({ length: 40 }, () => 'cd a; cd ..').join('; ') + '; ls')).toBeUndefined();
  expect(refused(Array.from({ length: 12 }, (_, index) => `cd d${index}`).join('; ') + '; ls')).toContain(
    'cannot follow',
  );
});

test('a command the guard cannot read is refused only when it names a config folder', () => {
  // A heredoc delimiter whose quote runs into the next line makes the shell reader give up.
  expect(refused("cat <<'E\n~/.config/werkflow'")).toContain('cannot read');
  expect(refused("cat <<'E\nhello'")).toBeUndefined();
});

test('the Read and Grep tools refuse a secret file and a search of its folder', () => {
  const call = (tool_name: string, tool_input: unknown) =>
    boatKeyToolRefusal({ tool_name, tool_input }, context);
  expect(call('Read', { file_path: '/home/agent/.config/werkflow/boat-api-key' })).toContain('Boat API key');
  expect(call('Read', { file_path: '~/.config/ascii/boat/config.json' })).toContain('Boat API key');
  expect(call('Grep', { pattern: 'boat_', path: '/home/agent/.config' })).toContain('Boat API key');
  expect(call('Grep', { pattern: 'token', path: '~' })).toContain('Boat API key');
  expect(call('Read', { file_path: '/home/agent/.config/werkflow/boat-api-key.expires' })).toBeUndefined();
  expect(call('Grep', { pattern: 'boat_', path: 'lib' })).toBeUndefined();
  expect(call('Grep', { pattern: 'boat_' })).toBeUndefined();
});

// The problem-report hand-out secret: a report thread works on a user's text, so the same shapes
// are refused for its file, while the helper and the dispatcher, which read it themselves, run.
const HANDOUT = 'the problem-report hand-out secret';

test('a command that names the hand-out secret file is refused', () => {
  for (const command of [
    'cat ~/.config/werkflow/problem-report-handout.env',
    'grep SECRET "$HOME/.config/werkflow/problem-report-handout.env"',
    'source ~/.config/werkflow/problem-report-handout.env && echo "$PROBLEM_REPORT_HANDOUT_SECRET"',
    'cp ~/.config/werkflow/problem-report-handout.env /tmp/handout',
    'bash -c "cat ~/.config/werkflow/problem-report-handout.env"',
    // Spellings the shell reader cannot follow: only the name in the text refuses them.
    'F=~/.config/werkflow/problem-report-handout.env; cat "$F"',
    'cat <<EOF | sh\ncat ~/.config/werkflow/problem-report-handout.env\nEOF',
  ])
    expect(refused(command), command).toContain(HANDOUT);
});

test('a spelling of the hand-out file that hides its name from the text is refused by its path', () => {
  // The quotes keep the name out of the raw text; the shell reader still resolves the path.
  expect(refused('cat ~/.config/werkflow/problem-report-"handout".env')).toContain(
    `names a file that holds ${HANDOUT}`,
  );
  expect(refused('cat ./problem-report-"handout".env', '/home/agent/.config/werkflow')).toContain(HANDOUT);
  expect(refused('cd ~/.config && cd werkflow && cat < problem-report-"handout".env')).toContain(HANDOUT);
});

test('a glob that matches the hand-out file is refused', () => {
  for (const command of ['cat ~/.config/werkflow/*.env', 'cd ~/.config/werkflow && head problem-report-*'])
    expect(refused(command), command).toContain(`matches a file that holds ${HANDOUT}`);
});

test('a recursive read of the folder that holds the hand-out file names it', () => {
  for (const command of [
    'grep -r SECRET ~/.config/werkflow',
    'rg --hidden HANDOUT ~/.config',
    'tar czf /tmp/config.tgz ~/.config',
  ])
    expect(refused(command), command).toMatch(
      new RegExp(`would read every file under .*${HANDOUT} included`),
    );
});

test('the Read and Grep tools refuse the hand-out file and a search of its folder', () => {
  const call = (tool_name: string, tool_input: unknown) =>
    boatKeyToolRefusal({ tool_name, tool_input }, context);
  expect(call('Read', { file_path: '~/.config/werkflow/problem-report-handout.env' })).toContain(HANDOUT);
  expect(call('Grep', { pattern: 'SECRET', path: '/home/agent/.config/werkflow' })).toContain(HANDOUT);
});

test('the helper and the dispatcher, which read the hand-out secret themselves, run', () => {
  for (const command of [
    'bun scripts/report-thread.ts hand-out 0b9f3c1e-5d2a-4c7b-9e8f-1a2b3c4d5e6f',
    'bun scripts/report-thread.ts screenshot 0b9f3c1e-5d2a-4c7b-9e8f-1a2b3c4d5e6f',
    'echo \'{"changes":{"status":"erledigt"}}\' | bun scripts/report-thread.ts write-back 0b9f3c1e-5d2a-4c7b-9e8f-1a2b3c4d5e6f',
    'python3 -I ~/code/werkflow-planning/ops/report-dispatch.py --dry-run',
    'bun run test:unit lib/problem-reports/report-thread-helper.test.ts',
  ])
    expect(refused(command), command).toBeUndefined();
});

// The hook itself, as the agent runs it: exit 2 with the reason refuses the call.
test('the hook refuses a read of the key and passes ordinary work', () => {
  const hook = resolve(import.meta.dir, '../../.claude/hooks/refuse-boat-key-reads.ts');
  const run = (payload: string) => spawnSync(process.execPath, [hook], { input: payload, encoding: 'utf8' });
  const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: '/' });
  const refusedRun = run(bash('cat ~/.config/werkflow/boat-api-key'));
  expect(refusedRun.status).toBe(2);
  expect(refusedRun.stderr).toContain('Refused');
  expect(run(bash('git status')).status).toBe(0);
  const handout = run(bash('cat ~/.config/werkflow/problem-report-handout.env'));
  expect(handout.status).toBe(2);
  expect(handout.stderr).toContain('hand-out secret');
  expect(run(bash('bun scripts/report-thread.ts hand-out 0b9f3c1e-5d2a-4c7b-9e8f-1a2b3c4d5e6f')).status).toBe(
    0,
  );
  expect(
    run(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '~/.config/ascii/boat/config.json' } }))
      .status,
  ).toBe(2);
  expect(run('not json').status).toBe(2);
});
