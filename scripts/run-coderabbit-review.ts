import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import {
  buildCodeRabbitReviewArguments,
  codeRabbitBinary,
  isCodeRabbitAuthenticated,
} from '../lib/testing/publication/coderabbit-review-command';

// `bun run review`: the optional local CodeRabbit pre-check before a push
// (docs/technical/coderabbit.md, "Run a local pre-check"). The review of
// record is the CodeRabbit app on the pull request.
const rawArguments = process.argv.slice(2);
const doctorOnly = rawArguments.includes('--doctor');
function runCommand(command: readonly string[]): number {
  const result = Bun.spawnSync({
    cmd: [...command],
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return result.exitCode;
}

function fail(message: string): never {
  console.error(`[coderabbit-review] ${message}`);
  process.exit(1);
}

const binary = codeRabbitBinary(homedir());
try {
  accessSync(binary, constants.X_OK);
} catch {
  fail(
    `${binary} is missing or not executable. Install it only while setting up a new development machine (docs/technical/environments.md); otherwise report this host problem to the owner.`,
  );
}

const authStatus = Bun.spawnSync({
  cmd: [binary, 'auth', 'status', '--agent'],
  stdout: 'pipe',
  stderr: 'inherit',
});
if (authStatus.exitCode !== 0 || !isCodeRabbitAuthenticated(authStatus.stdout.toString())) {
  fail(
    'CodeRabbit is installed but not authenticated. Ask the owner to run `coderabbit auth login` in a terminal. Do not reinstall the CLI.',
  );
}

if (doctorOnly) {
  console.info(`[coderabbit-review] ready: ${binary}`);
  process.exit(0);
}

let reviewArguments: string[];
try {
  reviewArguments = buildCodeRabbitReviewArguments(rawArguments);
} catch (error) {
  fail(error instanceof Error ? error.message : 'Invalid review arguments.');
}
const command = [binary, ...reviewArguments];

process.exit(runCommand(command));
