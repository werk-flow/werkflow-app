// Rule test: no agent shell call starts a sign-in, hands out an account token or runs the Vercel
// CLI, directly, through a package runner or wrapper, or hidden where the guard cannot read it.
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../zod';

import { accountSignInRefusal } from './account-sign-in';

const repositoryRoot = resolve(import.meta.dir, '../..');
const REFUSED = 'A sign-in is an owner step';

test('every Vercel CLI call is refused, through every runner and wrapper', () => {
  for (const command of [
    'vercel',
    'vercel whoami',
    'vercel login',
    'vercel list --prod',
    'vercel inspect dpl_a',
    'vercel metrics vercel.request.count --group-by route',
    'vercel api /v4/aliases/app.werk-flow.app',
    'vercel logs --help',
    'vercel --scope werkflows-projects logs',
    'vc list',
    'npx vercel list',
    'npx --yes vercel@65 logs --project prj_a',
    'bunx vercel whoami',
    'bun x vercel whoami',
    'pnpm dlx vercel list',
    'yarn dlx vercel@latest list',
    'npm exec -- vercel list',
    'cd /x && /usr/local/bin/vercel list | head',
    '/opt/homebrew/bin/vercel whoami',
    'timeout 60 vercel list',
    'sudo vercel list',
    'env VERCEL_ORG_ID=x vercel list',
    'xargs vercel inspect < ids.txt',
    'npm install -g vercel',
    'bash -c "vercel list"',
    "bash -lc 'npx vercel@65 list --json'",
    'eval vercel list',
    // A command substitution runs, quoted or not, and so does one in an expanding heredoc.
    'echo "$(vercel list --json)"',
    'echo $(vercel whoami)',
    'echo "`vercel whoami`"',
    'echo "$(printf x; echo "$(vercel list)")"',
    'cat <<EOF\n$(vercel list --json)\nEOF',
    // A `<<` in a comment or in quotes opens no heredoc, so the next line still runs.
    '# <<EOF\nvercel list',
    'echo "<<EOF"\nvercel list',
    // Each delimiter form ends its heredoc at the line `EOF`, so the next line runs.
    ...['\\EOF', "'EOF'", '"EOF"', 'E"OF"'].map(
      (delimiter) => `cat > note.md <<${delimiter}\nbody\nEOF\nvercel list`,
    ),
    'cat > note.md <<-EOF\n\tbody\n\tEOF\nvercel list',
    // A body that never reaches its delimiter is read as commands: the guard errs toward refusing.
    'cat > note.md <<EOF\nvercel list',
    // An arithmetic shift opens no heredoc.
    'echo $((1<<2))\nvercel list\n2',
  ])
    expect(accountSignInRefusal(command), command).toContain(REFUSED);
});

test('every listed sign-in and token command is refused, through every runner and wrapper', () => {
  for (const command of [
    'gh auth login',
    'gh auth login --web --hostname github.com',
    'gh auth refresh -s project',
    'gh auth switch --user other',
    'gh auth token',
    'gh auth setup-git',
    'supabase login',
    'supabase --debug login',
    'supabase --workdir /x login',
    'bunx supabase login',
    'npx --yes supabase@2 login --no-browser',
    'stripe login',
    'wrangler login',
    'npx wrangler@3 login',
    'railway login --browserless',
    'npx @railway/cli login',
    'firebase login',
    'firebase login:ci',
    'npx firebase-tools login',
    'az login --use-device-code',
    'gcloud auth login',
    'gcloud auth application-default login',
    'gcloud auth print-access-token',
    'doctl auth init',
    'codex login',
    'codex login --api-key x',
    'claude login',
    'claude setup-token',
    'claude auth login',
    'coderabbit auth login',
    'glab auth login',
    'npm login',
    'docker login ghcr.io',
    'aws sso login --profile x',
    'flyctl auth login',
    'netlify login',
    'heroku login',
    'timeout 60 gh auth login',
    'cd /x && gh auth status && gh auth token',
    'TOKEN="$(gh auth token)"',
    'bash -c "gh auth login"',
    "sh <<'EOF'\nsupabase login\nEOF",
    // A variable in the subcommand's place may be the sign-in.
    'gh auth "$VERB"',
    'supabase $COMMAND',
  ])
    expect(accountSignInRefusal(command), command).toContain(REFUSED);
});

test('a heredoc a shell runs is read as commands', () => {
  for (const command of [
    "bash <<'EOF'\nvercel list\nEOF",
    'sh <<EOF\ngh auth login\nEOF',
    'cat <<EOF | sh\nvercel list\nEOF',
    "cat <<'EOF' | bash -l\nsupabase login\nEOF",
    'bash -s <<EOF\nvercel list\nEOF',
    "source /dev/stdin <<'EOF'\ncodex login\nEOF",
  ])
    expect(accountSignInRefusal(command), command).toContain('starts a sign-in, hands out an account token');
});

// The backstop: a mention the guard cannot place as data is refused, never allowed.
test('a mention the guard cannot verify as data is refused', () => {
  for (const command of [
    `python3 -c "import os; os.system('vercel list')"`,
    `node -e "require('child_process').execSync('gh auth token')"`,
    "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['gh', 'auth', 'login'])\nEOF",
    "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['vercel', 'list'])\nEOF",
    'timeout 60 bash <<EOF\nvercel list\nEOF',
    'X=vercel; $X list',
    'ls # vercel list',
    'ls # supabase login',
    // git, gh and rg can run their text: an alias, --exec, a pager, --pre, a shell alias.
    "git -c alias.x='!vercel list' x",
    "git rebase --exec 'gh auth token' main",
    "git -c core.pager='vercel list' log",
    "rg --pre 'vercel list' pattern .",
    "gh alias set --shell x 'gh auth token'",
    // git reads a heredoc as a message only through -F -.
    "git am <<'EOF'\nvercel list\nEOF",
    // A data program piped into a shell runs its words.
    'echo "vercel list" | sh',
    "printf 'gh auth login\\n' | bash",
    'echo vercel list | xargs -I{} sh -c {}',
    'echo "vercel list" | env bash',
    'echo "gh auth login" | timeout 60 /bin/sh',
    // An argument array in a script names the program and its words apart.
    `node -e 'require("child_process").execFileSync("gh", ["auth", "login"])'`,
    `python3 -c 'import subprocess; subprocess.run(["supabase", "login"])'`,
    // ANSI-C or locale quoting anywhere, substitutions and heredoc bodies included.
    "echo $'\\''; vercel list",
    'echo $"x"; gh auth login',
    '/usr/bin/env -S "vercel list"',
    // A heredoc delimiter the reader cannot place.
    'cat > note.md <<"EOF\nvercel list\nEOF"',
  ])
    expect(accountSignInRefusal(command), command).toContain(REFUSED);
  expect(accountSignInRefusal(`python3 -c "import os; os.system('vercel list')"`)).toContain(
    'could not place `python3 -c',
  );
});

test('everyday commands, other subcommands and mentions as data pass', () => {
  for (const command of [
    'git status',
    'git log --oneline -5 && git diff --stat origin/main',
    'bun run test:unit',
    'bun test lib/security',
    'gh pr view 206 --json state,headRefOid',
    'gh api repos/werk-flow/werkflow-app/pulls/206/comments --jq ".[].id"',
    'gh api graphql -f query="{ viewer { login } }"',
    'gh auth status',
    'gh issue view 478 -R werk-flow/werkflow-planning',
    'bunx supabase db reset',
    'bunx supabase db push --linked',
    'bunx supabase functions deploy login',
    'bunx supabase projects list',
    'supabase status',
    'codex exec "fix it"',
    'coderabbit auth status && coderabbit review --plain',
    'docker ps && docker exec supabase_db_werkflow psql -c "select 1"',
    'npm view next version',
    'claude mcp add --scope user --transport http supabase "https://example.test/mcp"',
    'brew uninstall vercel-cli',
    'which vercel',
    'ls -l /usr/local/bin/vercel /opt/homebrew/bin/vercel',
    'mkdir -p ~/.config/gh && ls ~/.claude ~/.codex',
    'cat .vercel/project.json && jq . vercel.json',
    'grep -rn "@vercel/functions" lib node_modules/vercel/package.json',
    'grep -rn vercel docs',
    'grep -rn "gh auth login" docs',
    'echo Vercel',
    'git commit -m "Refuse vercel and gh auth login"',
    'git commit --message="The hook refuses vercel list"',
    'git commit -am "Block vercel and gh auth login"',
    'gh pr create -t "Block vercel" -b "Guard gh auth token"',
    "git commit -F - <<'EOF'\nThe hook refuses vercel list and supabase login.\nEOF",
    'gh pr create --title "Refuse gh auth token" --body "The hook refuses vercel list."',
    "gh pr comment 206 --body-file - <<'EOF'\nThe hook refuses `vercel list` and $(gh auth token).\nEOF",
    "cat > note.md <<'EOF'\nvercel list\ngh auth login\nEOF",
    "echo '$(vercel list)'",
    'cat <<<"vercel list"',
    "tee note.md <<'EOF' | wc -l\nvercel list\nEOF",
    ...['\\EOF', "'EOF'", '"EOF"', 'E"OF"'].map(
      (delimiter) => `cat > note.md <<${delimiter}\n$(vercel list)\nEOF`,
    ),
    'tail ~/.local/state/ci-alert.log',
  ])
    expect(accountSignInRefusal(command), command).toBeUndefined();
});

/** The hook's exit code and output for one stdin payload. */
function callHook(stdin: string) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, resolve(repositoryRoot, '.claude/hooks/refuse-account-sign-in.ts')],
    stdin: Buffer.from(stdin),
    stderr: 'pipe',
  });
  return { exitCode: result.exitCode, output: result.stderr.toString() };
}

test('the hook refuses a sign-in with the reason and lets other commands through', () => {
  const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  for (const stdin of [bash('npx --yes vercel@65 list'), bash('gh auth login'), 'not json', 'null']) {
    const refused = callHook(stdin);
    expect(refused.exitCode, stdin).toBe(2);
    expect(refused.output, stdin).toContain('Refused:');
  }
  expect(callHook(bash('supabase login')).output).toContain(REFUSED);
  for (const stdin of [
    bash('gh pr view 1'),
    JSON.stringify({ tool_name: 'Bash', tool_input: { cmd: 'bunx supabase db reset' } }),
    JSON.stringify({ tool_name: 'Edit', tool_input: {} }),
  ]) {
    const allowed = callHook(stdin);
    expect(allowed.exitCode, allowed.output).toBe(0);
  }
});

const hookFileSchema = z.object({
  hooks: z.object({
    PreToolUse: z.array(z.object({ hooks: z.array(z.object({ command: z.string() })) })),
  }),
});

/** The command an agent's hook file registers for the sign-in guard. */
function registeredGuard(file: string): string {
  const { hooks } = hookFileSchema.parse(JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8')));
  const command = hooks.PreToolUse.flatMap((entry) => entry.hooks)
    .map((hook) => hook.command)
    .find((text) => text.includes('refuse-account-sign-in.ts'));
  if (!command) throw new Error(`${file} registers no refuse-account-sign-in.ts.`);
  return command;
}

function runRegistered(command: string, options: { cwd: string; path?: string }) {
  const result = Bun.spawnSync({
    cmd: ['/bin/sh', '-c', command],
    cwd: options.cwd,
    stdin: Buffer.from(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh auth login' } })),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repositoryRoot, PATH: options.path ?? process.env.PATH ?? '' },
  });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

// Codex runs a command hook in the session's working directory: the registered command must find
// the script from a subfolder.
test('the Codex hook command refuses a sign-in from a subfolder of the repository', () => {
  const result = runRegistered(registeredGuard('.codex/hooks.json'), {
    cwd: resolve(repositoryRoot, 'lib/security'),
  });
  expect(result.exitCode, result.stderr).toBe(2);
  expect(result.stderr).toContain(REFUSED);
});

// Both agents block only on exit 2; any other failure of the guard would let the call through.
test('both registered hook commands refuse when the guard itself fails', () => {
  const bin = mkdtempSync(join(tmpdir(), 'broken-bun-'));
  writeFileSync(join(bin, 'bun'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  for (const file of ['.claude/settings.json', '.codex/hooks.json']) {
    const result = runRegistered(registeredGuard(file), {
      cwd: repositoryRoot,
      path: `${bin}:${process.env.PATH ?? ''}`,
    });
    expect(result.exitCode, file).toBe(2);
    expect(result.stderr, file).toContain('the sign-in guard failed with exit 1');
  }
});
