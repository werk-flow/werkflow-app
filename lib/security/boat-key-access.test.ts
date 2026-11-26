// Rule test: no agent call reads, prints or searches the workstation's Boat API key or the Boat
// CLI's config; only the process that calls Boat reads the key.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { boatKeyCommandRefusal, boatKeyToolRefusal, liveBackupsOnDisk, shellFolder } from './boat-key-access';

const home = '/home/agent';
const context = { cwd: '/home/agent/code/werkflow-app', home, liveBackupsUnder: () => [] };
const refused = (command: string, cwd = context.cwd) => boatKeyCommandRefusal(command, { ...context, cwd });

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
  // `~/.config/werkflow/*` matches the hand-out file too, so its refusal names both secrets.
  for (const command of [
    'cat ~/.config/werkflow/*',
    'head ~/.config/werkflow/boat-api-*',
    'cat ~/.config/ascii/*/config.json',
    'cat $HOME/.config/*/boat/*.json',
    'cd ~/.config/werkflow; tail -n1 *',
    'cat ../../.config/werkflow/b*',
  ])
    expect(refused(command), command).toMatch(/matches (?:a file that holds|files that hold) a Boat API key/);
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
  expect(boatKeyCommandRefusal('cat b*', { ...context, cwd: folder })).toContain('matches a file');
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
  // The folder's other secret files share the `.env` suffix, so the refusal may name them too.
  for (const command of ['cat ~/.config/werkflow/*.env', 'cd ~/.config/werkflow && head problem-report-*'])
    expect(refused(command), command).toMatch(
      new RegExp(`matches (?:a file that holds|files that hold) ${HANDOUT}`),
    );
});

test('a recursive read of the folder that holds the hand-out file names it', () => {
  for (const command of [
    'grep -r SECRET ~/.config/werkflow',
    'rg --hidden HANDOUT ~/.config',
    'tar czf /tmp/config.tgz ~/.config',
  ])
    expect(refused(command), command).toMatch(
      new RegExp(`would read every file under .*${HANDOUT}.* included`),
    );
});

test('the Read and Grep tools refuse the hand-out file and a search of its folder', () => {
  const call = (tool_name: string, tool_input: unknown) =>
    boatKeyToolRefusal({ tool_name, tool_input }, context);
  expect(call('Read', { file_path: '~/.config/werkflow/problem-report-handout.env' })).toContain(HANDOUT);
  expect(call('Grep', { pattern: 'SECRET', path: '/home/agent/.config/werkflow' })).toContain(HANDOUT);
});

test('a command that would read both secrets names both and what to do instead for each', () => {
  const both =
    /a Boat API key[^]*the problem-report hand-out secret[^]*`bun run test:verify`[^]*report-thread/;
  for (const command of [
    // One glob over the folder of both files.
    'cat ~/.config/werkflow/*',
    // Two operands, each naming one file by its path.
    'cat ~/.config/werkflow/b"oat-api-key" ~/.config/werkflow/problem-report-"handout".env',
    // Two raw mentions in one text.
    'F=~/.config/werkflow/boat-api-key; G=~/.config/werkflow/problem-report-handout.env; cat "$F" "$G"',
    // A recursive read of a folder that holds both.
    'grep -r SECRET ~/.config/werkflow',
  ])
    expect(refused(command), command).toMatch(both);
  // A mention of one and a path to the other in the same line.
  const mixed = refused(
    'cat ~/.config/werkflow/boat-api-key ~/.config/werkflow/problem-report-"handout".env',
  );
  expect(mixed).toContain('a Boat API key');
  expect(mixed).toContain(HANDOUT);
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

// The agents' staging keys, the watcher's token, the Supabase CLI's login and the old sandbox
// folder: the same shapes are refused, and each refusal names who reads the file instead.
const HOME_SECRETS = [
  {
    file: '~/.config/werkflow/staging-agents.env',
    holds: "the agents' staging keys",
    instead: 'bun run agent-access:check',
  },
  {
    file: '~/.config/werkflow/prod-watch.env',
    holds: "the production watcher's Vercel token",
    instead: 'ops/prod_watch.py',
  },
  { file: '~/.supabase/access-token', holds: "the Supabase CLI's login token", instead: 'bunx supabase' },
  {
    file: '~/.werkflow-stripe-sandbox/key.env',
    holds: 'a Stripe sandbox key',
    instead: 'STRIPE_SANDBOX_KEY',
  },
];

test('a read, print, copy or search of an agent-machine secret is refused and names who reads it', () => {
  for (const { file, holds, instead } of HOME_SECRETS) {
    const quoted = file.replace(/\/([^/]+)$/, '/"$1"');
    for (const command of [
      `cat ${file}`,
      `grep KEY ${file}`,
      `cp ${file} /tmp/copy`,
      `source ${file} && echo "$KEY"`,
      `bash -c "head -c 8 ${file}"`,
      // The quotes keep the name out of the raw text; the path still resolves.
      `cat ${quoted}`,
    ]) {
      const reason = refused(command);
      expect(reason, command).toContain(holds);
      expect(reason, command).toContain(instead);
    }
    expect(
      boatKeyToolRefusal({ tool_name: 'Read', tool_input: { file_path: file } }, context),
      file,
    ).toContain(holds);
  }
});

test('a glob or a recursive read that reaches an agent-machine secret is refused', () => {
  for (const { command, holds } of [
    { command: 'cat ~/.config/werkflow/*.env', holds: "the agents' staging keys" },
    { command: 'cat ~/.config/werkflow/s*', holds: "the agents' staging keys" },
    { command: 'cat ~/.supabase/*', holds: "the Supabase CLI's login token" },
    { command: 'cat ~/.werkflow-stripe-sandbox/*', holds: 'a Stripe sandbox key' },
    { command: 'cat ~/.werkflow-*/key.env', holds: 'a Stripe sandbox key' },
    { command: 'grep -r sk_test ~/.werkflow-stripe-sandbox', holds: 'a Stripe sandbox key' },
    { command: 'cd ~/.werkflow-stripe-sandbox && grep -r sk_ .', holds: 'a Stripe sandbox key' },
    { command: 'grep -r token ~/.supabase', holds: "the Supabase CLI's login token" },
    { command: 'rg --hidden VERCEL ~/.config/werkflow', holds: "the production watcher's Vercel token" },
  ])
    expect(refused(command), command).toContain(holds);
  expect(
    boatKeyToolRefusal(
      { tool_name: 'Grep', tool_input: { pattern: 'sk_', path: '~/.werkflow-stripe-sandbox' } },
      context,
    ),
  ).toContain('a Stripe sandbox key');
  for (const command of [
    'ls -la ~/.config/werkflow',
    'bun run agent-access:check',
    'bunx supabase projects list',
  ])
    expect(refused(command), command).toBeUndefined();
});

// `.env.live-backup` holds PROD keys in any checkout. A checkout is where agents work, so a
// recursive read counts it only where the reader surely reads, and rg's default skips it.
const checkout = '/home/agent/code/werkflow-app';
const liveBackup = `${checkout}/.env.live-backup`;
const withLiveBackup = {
  cwd: checkout,
  home,
  liveBackupsUnder: (folder: string) =>
    folder === checkout || folder === '/home/agent/code' ? [liveBackup] : [],
};
const refusedInCheckout = (command: string) => boatKeyCommandRefusal(command, withLiveBackup);

test('a read of .env.live-backup in any checkout is refused and names the production session', () => {
  for (const command of [
    'cat .env.live-backup',
    'grep SUPABASE ../other-checkout/.env.live-backup',
    'cp .env.live-backup .env.local',
    'cat .env.live-"backup"',
    'cat /srv/any/.env.live-"backup"',
    'cat .env*',
    'grep -h KEY .env.l*',
    'grep -r SUPABASE .',
    'grep -r SUPABASE',
    'grep -R KEY ~/code',
    'rg -uu SUPABASE .',
    'rg --no-ignore KEY',
    'tar czf /tmp/checkout.tgz .',
    'find . -type f -exec cat {} +',
  ]) {
    const reason = refusedInCheckout(command);
    expect(reason, command).toContain('PROD keys');
    expect(reason, command).toContain('bun run env:prod');
  }
  const tool = (tool_name: string, tool_input: unknown) =>
    boatKeyToolRefusal({ tool_name, tool_input }, withLiveBackup);
  expect(tool('Read', { file_path: '.env.live-backup' })).toContain('PROD keys');
  expect(tool('Read', { file_path: '/srv/other/.env.live-backup' })).toContain('PROD keys');
  expect(tool('Grep', { pattern: 'KEY', path: '.env.live-backup' })).toContain('PROD keys');
});

test('an option value or an -e pattern never counts as the folder a recursive grep searches', () => {
  // Each reads the checkout it runs in: a value word or a pattern is no folder operand.
  for (const command of [
    'grep -r -A 3 KEY',
    'grep -rn -m 5 KEY',
    'grep -r --exclude-dir node_modules KEY',
    'grep -d recurse KEY',
    'grep -r -e A -e B',
    'grep -r -f patterns.txt',
    'grep -r --regexp=KEY',
  ])
    expect(refusedInCheckout(command), command).toContain('PROD keys');
  // A path beside the pattern, after `-e` or after `--`, stays the only folder read.
  for (const command of ['grep -rn KEY lib/', 'grep -r -e KEY lib/', 'grep -r -- -KEY lib/'])
    expect(refusedInCheckout(command), command).toBeUndefined();
});

test('ordinary work in a checkout that holds .env.live-backup passes', () => {
  for (const command of [
    'grep -rn boatKeyCommandRefusal lib/',
    'rg --hidden token .',
    'rg token',
    'cp -r .agent-logs ~/scratch/evidence',
    'cat .env.local',
    'ls -la',
    // The shell's wildcard skips dot files.
    'wc -l *',
    'bun run env:dev',
    'find . -name "*.ts"',
  ])
    expect(refusedInCheckout(command), command).toBeUndefined();
  // Without a live backup on the disk, a glob over the env files passes.
  expect(refused('ls -la .env*')).toBeUndefined();
  // The Grep tool runs ripgrep, which skips the git-ignored backup.
  expect(
    boatKeyToolRefusal({ tool_name: 'Grep', tool_input: { pattern: 'KEY' } }, withLiveBackup),
  ).toBeUndefined();
});

test('the disk reader finds .env.live-backup anywhere in the tree it reads', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-backup-'));
  try {
    // A checkout three levels down that holds another checkout, and a node_modules the walk skips.
    const outer = join(root, 'worktrees/app/one');
    const inner = join(outer, 'vendor/inner');
    mkdirSync(join(outer, 'node_modules/pkg'), { recursive: true });
    mkdirSync(inner, { recursive: true });
    for (const folder of [outer, inner]) writeFileSync(join(folder, '.git'), 'gitdir: /made/up\n');
    for (const folder of [outer, inner, join(outer, 'node_modules/pkg')])
      writeFileSync(join(folder, '.env.live-backup'), 'MADE_UP=1\n');
    expect(liveBackupsOnDisk(root, Infinity)?.sort()).toEqual([
      join(outer, '.env.live-backup'),
      join(inner, '.env.live-backup'),
    ]);
    // A glob reaches only as deep as its pattern.
    expect(liveBackupsOnDisk(root, 2)).toEqual([]);
    expect(liveBackupsOnDisk(join(root, 'worktrees/app'), 1)).toEqual([join(outer, '.env.live-backup')]);
    // A missing path and a file operand hold none.
    expect(liveBackupsOnDisk(join(root, 'missing'), Infinity)).toEqual([]);
    expect(liveBackupsOnDisk(join(outer, '.git'), Infinity)).toEqual([]);
    expect(liveBackupsOnDisk(join(outer, '.git', 'below'), Infinity)).toEqual([]);
    // A folder that fails to list for another reason, here a symlink loop, cannot be told.
    symlinkSync(join(root, 'loop'), join(root, 'loop'));
    expect(liveBackupsOnDisk(join(root, 'loop'), Infinity)).toBeUndefined();
    // A tree larger than the walk's bound cannot be told.
    for (let index = 0; index <= 4000; index++)
      mkdirSync(join(root, 'wide', String(index)), { recursive: true });
    expect(liveBackupsOnDisk(join(root, 'wide'), Infinity)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the disk reader follows a linked folder to .env.live-backup and cannot tell a link back up', () => {
  const root = mkdtempSync(join(tmpdir(), 'live-backup-links-'));
  try {
    const target = join(root, 'target');
    const scan = join(root, 'scan');
    mkdirSync(target);
    mkdirSync(scan);
    writeFileSync(join(target, '.env.live-backup'), 'MADE_UP=1\n');
    writeFileSync(join(root, 'notes.txt'), 'made up\n');
    symlinkSync(target, join(scan, 'linked'));
    // A link to a file or to nothing holds no backup.
    symlinkSync(join(root, 'notes.txt'), join(scan, 'file-link'));
    symlinkSync(join(root, 'missing'), join(scan, 'dangling'));
    expect(liveBackupsOnDisk(scan, Infinity)).toEqual([join(scan, 'linked', '.env.live-backup')]);
    // grep -R follows the link, so its read of the scanned folder is refused.
    const onDisk = { cwd: root, home, liveBackupsUnder: liveBackupsOnDisk };
    expect(boatKeyCommandRefusal(`grep -R KEY ${scan}`, onDisk)).toContain('PROD keys');
    // A link back up the tree repeats it until the walk gives up.
    symlinkSync(root, join(target, 'up'));
    expect(liveBackupsOnDisk(scan, Infinity)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a recursive read of a tree too large to walk is refused for .env.live-backup', () => {
  const untold = {
    cwd: checkout,
    home,
    liveBackupsUnder: (folder: string) => (folder === '/srv/huge' ? undefined : []),
  };
  expect(boatKeyCommandRefusal('grep -r KEY /srv/huge', untold)).toContain('cannot tell whether /srv/huge');
  // rg skips the git-ignored file, so it needs no walk.
  expect(boatKeyCommandRefusal('rg KEY /srv/huge', untold)).toBeUndefined();
});

test('an rg or Grep glob that brings back .env.live-backup makes the search count it', () => {
  for (const command of [
    "rg -g '.env*' KEY .",
    'rg --glob=.env.* KEY',
    "rg --iglob '**/.env.l*' KEY .",
    // A separate glob value is no path operand: rg searches where it runs.
    "rg -g '.env*' KEY",
    // An iglob matches without case.
    "rg --iglob '.ENV.LIVE*' KEY .",
  ])
    expect(refusedInCheckout(command), command).toContain('PROD keys');
  for (const command of ["rg -g '*.ts' token .", "rg -g '!.env*' token ."])
    expect(refusedInCheckout(command), command).toBeUndefined();
  const grep = (tool_input: unknown) => boatKeyToolRefusal({ tool_name: 'Grep', tool_input }, withLiveBackup);
  expect(grep({ pattern: 'KEY', glob: '.env*' })).toContain('PROD keys');
  expect(grep({ pattern: 'KEY', glob: '*.ts' })).toBeUndefined();
});

test('a path-qualified glob counts when its final segment names .env.live-backup', () => {
  const work = {
    cwd: checkout,
    home,
    liveBackupsUnder: (folder: string) => (folder === '/srv/work' ? ['/srv/work/app/.env.live-backup'] : []),
  };
  expect(boatKeyCommandRefusal("rg -g 'app/.env*' KEY /srv/work", work)).toContain('PROD keys');
  expect(boatKeyCommandRefusal("rg -g 'src/**/*.ts' KEY /srv/work", work)).toBeUndefined();
  const grep = (glob: string) =>
    boatKeyToolRefusal({ tool_name: 'Grep', tool_input: { pattern: 'KEY', path: '/srv/work', glob } }, work);
  expect(grep('app/.env*')).toContain('PROD keys');
  expect(grep('src/**/*.ts')).toBeUndefined();
});

test('a search for a secret file name in the repository passes, a read of the file does not', () => {
  for (const command of [
    'grep -rn "staging-agents.env" docs/',
    "rg -n '.env.live-backup' scripts",
    'grep -rn -e prod-watch.env -e boat-api-key lib/',
    'git diff | grep .env.live-backup',
    'grep -rn -- .env.live-backup scripts',
  ])
    expect(refusedInCheckout(command), command).toBeUndefined();
  for (const command of [
    // The name is an operand, a pattern file, or an attached pattern flag hides the operand.
    'grep -e KEY ~/.config/werkflow/staging-agents.env',
    'grep --regexp=KEY ~/.config/werkflow/staging-agents.env',
    'grep -f ~/.config/werkflow/staging-agents.env README.md',
    'grep -ie KEY .env.live-backup',
    // The same spelling read elsewhere in the line, or through a variable.
    'cat .env.live-backup | grep .env.live-backup',
    'F=~/.config/werkflow/staging-agents.env; grep KEY "$F"',
    // After `--`, `-e` is the pattern and the file an operand.
    'grep -- -e ~/.config/werkflow/staging-agents.env',
    // An option that may take a value leaves no word a pattern: rg reads this file as ignore rules.
    'rg --ignore-file ~/.config/werkflow/staging-agents.env KEY',
  ])
    expect(refusedInCheckout(command), command).toMatch(/staging keys|PROD keys/);
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
  // A recursive search given a file or a folder operand walks the disk without failing.
  const inTmp = (command: string) =>
    run(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: tmpdir() }));
  expect(inTmp('grep -r token /dev/null').status).toBe(0);
  expect(inTmp('grep -r token /proc/self/fdinfo').status).toBe(0);
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
