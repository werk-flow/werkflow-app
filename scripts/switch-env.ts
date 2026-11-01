// Swap .env.local between the local-stack, dev, and live (prod) backends.
// Run via: bun run env:local  |  bun run env:dev  |  bun run env:prod
//
// Copies the respective gitignored backup file over .env.local. The backups
// (.env.local-stack-backup, .env.dev-backup, .env.live-backup) are outside
// Next.js's env loading chain and never committed.
//
// The local target also pins the stack's address to the loopback origin the
// Supabase CLI publishes, so a backup that carries another address is
// corrected in place. The local and dev targets point NEXT_PUBLIC_SITE_URL at
// this checkout's test server, whose port a worktree derives from its path, so
// invite and password links reach the server that sent them.
// See docs/technical/environments.md.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceAppOrigin } from '../lib/testing/runner/app-port';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';

const BACKUP_FILES = {
  local: '.env.local-stack-backup',
  dev: '.env.dev-backup',
  prod: '.env.live-backup',
} as const;

function isBackupTarget(value: string | undefined): value is keyof typeof BACKUP_FILES {
  return value !== undefined && Object.hasOwn(BACKUP_FILES, value);
}

const target = process.argv[2];
if (!isBackupTarget(target)) {
  console.error('Usage: bun scripts/switch-env.ts <local|dev|prod>');
  process.exit(1);
}

const repoRoot = join(import.meta.dir, '..');
const source = join(repoRoot, BACKUP_FILES[target]);
if (!existsSync(source)) {
  console.error(`Backup file missing: ${source}. Cannot switch.`);
  process.exit(1);
}

const LOCAL_STACK_ORIGIN = 'http://127.0.0.1:54321';
const environmentFile = join(repoRoot, '.env.local');
const siteUrlLine = `NEXT_PUBLIC_SITE_URL=${workspaceAppOrigin(repoRoot)}`;
// A worktree starts with a link to the main checkout's file; its own switch replaces the link
// instead of writing through it, right before the new contents land.
const writeEnvironment = (contents: string): void => {
  rmSync(environmentFile, { force: true });
  writeFileSync(environmentFile, contents);
};
const withSiteUrl = (contents: string): string =>
  /^NEXT_PUBLIC_SITE_URL=.*$/m.test(contents)
    ? contents.replace(/^NEXT_PUBLIC_SITE_URL=.*$/m, siteUrlLine)
    : `${contents.replace(/\n?$/, '\n')}${siteUrlLine}\n`;

await withWorkspaceTestLock(
  { operation: `switch environment to ${target}`, repositoryRoot: repoRoot },
  async () => {
    if (target === 'local') {
      const backupContents = readFileSync(source, 'utf8');
      // A missing line would make the replace a silent no-op and leave .env.local
      // half-stale; fail here instead of in a later preflight.
      if (
        !/^NEXT_PUBLIC_SUPABASE_URL=.*$/m.test(backupContents) ||
        !/^R2_ENDPOINT=.*$/m.test(backupContents)
      ) {
        throw new Error(
          `${BACKUP_FILES.local} must define NEXT_PUBLIC_SUPABASE_URL and R2_ENDPOINT; restore it per docs/technical/environments.md.`,
        );
      }
      const refreshed = backupContents
        .replace(/^NEXT_PUBLIC_SUPABASE_URL=.*$/m, `NEXT_PUBLIC_SUPABASE_URL=${LOCAL_STACK_ORIGIN}`)
        .replace(/^R2_ENDPOINT=.*$/m, `R2_ENDPOINT=${LOCAL_STACK_ORIGIN}/storage/v1/s3`);
      writeFileSync(source, refreshed);
      writeEnvironment(withSiteUrl(refreshed));
      console.log(
        `.env.local now points at the LOCAL Supabase stack (${LOCAL_STACK_ORIGIN}, werkflow-documents-local). Start it with \`supabase start\` if it is not running.`,
      );
    } else if (target === 'dev') {
      writeEnvironment(withSiteUrl(readFileSync(source, 'utf8')));
    } else {
      writeEnvironment(readFileSync(source, 'utf8'));
    }

    if (target === 'prod') {
      console.warn(
        [
          '',
          '############################################################',
          '##  WARNING: .env.local now points at the LIVE PRODUCTION ##',
          '##  Supabase project and the PROD R2 bucket.              ##',
          '##  Real customer data. Do NOT run tests or destructive   ##',
          '##  scripts. Switch back with: bun run env:dev            ##',
          '############################################################',
          '',
        ].join('\n'),
      );
    } else if (target === 'dev') {
      console.log(
        '.env.local now points at the cloud DEV backend (mbkkzuqjbdvzelqvuzcn, werkflow-documents-dev).',
      );
    }
  },
);
