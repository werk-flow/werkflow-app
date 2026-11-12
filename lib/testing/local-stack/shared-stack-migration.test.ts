// Rule test: an agent's shell call never puts a tree's migration into the shared local stack. The
// guard refuses each way the Supabase CLI or psql would, names the sanctioned command, and leaves
// alone a mention, a read and a call that reaches another database.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { sharedStackMigrationRefusal } from './shared-stack-migration';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const LOCAL_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const DEV_URL = 'postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';

test('the Supabase CLI never applies a tree migration to the local stack', () => {
  for (const command of [
    'supabase migration up',
    'bunx supabase migration up',
    'bunx supabase migration up --local',
    'bun x supabase migration up --include-all',
    'cd /work/app && npx supabase migration up 2>&1 | tail -5',
    'bash -lc "cd /work/app && supabase migration up"',
    'SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io timeout 300 bunx supabase migration up',
    'node_modules/.bin/supabase --workdir /work/app migration up',
    'bunx supabase@2.116.0 migration up',
    'npx -y supabase@latest migration up --local',
    'supabase migration down --last 1',
    'supabase db push --local',
    'supabase db push --include-all --local',
    `supabase db push --db-url ${LOCAL_URL}`,
    `supabase migration up --db-url "${LOCAL_URL}"`,
    'supabase migration repair --local --status reverted 20261130090003',
  ]) {
    const refusal = sharedStackMigrationRefusal(command);
    expect(refusal, command).toContain('holds only main');
    expect(refusal, command).toContain('bun run types:generate -- --local');
    expect(refusal, command).toContain('bun run stack:sync');
  }
});

test('a raw reset is refused, because it replays this tree, and names the sanctioned reset', () => {
  for (const command of [
    'supabase db reset',
    'bunx supabase db reset --local',
    'sudo supabase db reset',
    'bunx supabase@2.101.0 db reset',
  ])
    expect(sharedStackMigrationRefusal(command), command).toContain('bun run stack:reset');
});

test('a migration file never reaches psql on this machine', () => {
  const file = 'supabase/migrations/20261130090003_add_a_table.sql';
  for (const command of [
    `docker exec -i supabase_db_werkflow-app psql -U postgres -d postgres < ${file}`,
    `cat ${file} | docker exec -i supabase_db_werkflow-app psql -U postgres`,
    `psql ${LOCAL_URL} -f ${file}`,
    `psql -h 127.0.0.1 -p 54322 -U postgres -f /work/app/${file}`,
    `PGPASSWORD=postgres psql -h localhost -p 54322 -U postgres postgres -v ON_ERROR_STOP=1 --file=${file}`,
    // An include in a heredoc psql reads (CodeRabbit on #363).
    `psql -h localhost -p 54322 -U postgres <<'SQL'\n\\i ${file}\nSQL`,
    `docker exec -i supabase_db_werkflow-app psql -U postgres <<SQL\n\\ir ${file}\nSQL`,
    // A nested shell's psql inherits the outer heredoc (sol-loop on CodeRabbit's fix, S6).
    `bash -lc 'psql -h localhost -p 54322 -U postgres' <<'SQL'\n\\i ${file}\nSQL`,
  ]) {
    const refusal = sharedStackMigrationRefusal(command);
    expect(refusal, command).toContain(`\`psql\` with ${file}`);
    expect(refusal, command).toContain('bun run test:verify');
  }
});

test('reads, mentions, other targets and the sanctioned commands pass', () => {
  for (const command of [
    'bun run stack:sync',
    'bun run stack:reset',
    'bun run types:generate -- --local',
    'supabase migration list --local',
    'supabase migration new add_a_table',
    'supabase status',
    'supabase start',
    'supabase db push --local --dry-run',
    // DEV and PROD have their own rule and their own workflows.
    'supabase db push',
    `supabase db push --db-url ${DEV_URL}`,
    'supabase migration up --linked',
    'supabase migration repair --status applied 20261130090003',
    'git grep -n "supabase migration up" docs',
    'echo run supabase db reset later',
    "git commit -m 'refuse supabase migration up on the shared stack'",
    "cat >> notes.md <<'EOF'\nnever supabase migration up here\nEOF",
    'cat supabase/migrations/20261130090003_add_a_table.sql',
    // Printing a migration beside a psql call feeds psql nothing.
    'cat supabase/migrations/20261130090003_add_a_table.sql && docker exec supabase_db_werkflow-app psql -U postgres -c "select 1"',
    'cat supabase/migrations/20261130090003_add_a_table.sql | head -n 20; docker exec supabase_db_werkflow-app psql -U postgres -c "select 1"',
    'docker exec supabase_db_werkflow-app psql -U postgres -c "select count(*) from public.jobs"',
    `psql ${DEV_URL} -f supabase/migrations/20261130090003_add_a_table.sql`,
    'docker exec -i supabase_db_werkflow-app psql -U postgres < supabase/tests/problem_reports.sql',
  ])
    expect(sharedStackMigrationRefusal(command), command).toBeUndefined();
});

test('a call the guard cannot read passes: the ledger trigger refuses the write below it', () => {
  expect(sharedStackMigrationRefusal('cat <<$(x)\nsupabase migration up\n')).toBeUndefined();
});

// The hook file itself: it reads the call on stdin, exits 2 with the reason on stderr, else 0.
function runHook(input: string): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, ['.claude/hooks/refuse-shared-stack-migration.ts'], {
    cwd: repositoryRoot,
    input,
    encoding: 'utf8',
  });
  return { status: result.status, stderr: result.stderr };
}

test('the hook refuses a shell call from either agent tool and passes the rest', () => {
  const refused = runHook(
    JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'bunx supabase migration up' } }),
  );
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain('Refused: `supabase migration up`');
  expect(runHook(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' } })).status).toBe(
    0,
  );
  expect(
    runHook(JSON.stringify({ tool_name: 'Write', tool_input: { command: 'supabase migration up' } })).status,
  ).toBe(0);
  expect(runHook('not json').status).toBe(0);
});
