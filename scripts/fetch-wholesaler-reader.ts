import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { installWholesalerReader, ReaderInstallError } from '../lib/inventory/wholesaler-reader-install';

// The first step of `postinstall` (package.json): installs the wholesaler-file reader with
// WERKFLOW_DATANORM_TOKEN, or its stand-in without it (lib/inventory/wholesaler-reader-install.ts).
// `--github-login` uses this machine's GitHub login (`gh auth token`) when the variable is unset,
// to run the real reader on an agent machine; nothing passes it by default.
const flags = process.argv.slice(2);
const unknown = flags.filter((flag) => flag !== '--github-login');
if (unknown.length > 0) {
  console.error(
    `[wholesaler-reader] Unknown argument ${unknown.join(' ')}. The only flag is --github-login.`,
  );
  process.exit(1);
}

function githubLogin(): string {
  const result = spawnSync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) throw new Error('gh auth token failed');
  return result.stdout;
}

try {
  const install = await installWholesalerReader({
    root: resolve(import.meta.dir, '..'),
    env: process.env,
    githubLogin: flags.includes('--github-login') ? githubLogin : undefined,
    fetch,
  });
  console.log(
    install.kind === 'reader'
      ? `[wholesaler-reader] Installed ${install.repository} at ${install.commit}.`
      : '[wholesaler-reader] No key, so the stand-in is installed: the wholesaler import is unavailable here.',
  );
} catch (error) {
  // Only the installer's own messages are shown: another error may quote what GitHub sent.
  const unexpected = `The install failed (${error instanceof Error ? error.name : 'unknown error'}).`;
  console.error(`[wholesaler-reader] ${error instanceof ReaderInstallError ? error.message : unexpected}`);
  process.exitCode = 1;
}
