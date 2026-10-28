import { join } from 'node:path';

/** Where the CodeRabbit installer puts the CLI for the developer's own account. */
export function codeRabbitBinary(home: string): string {
  return join(home, '.local/bin/coderabbit');
}

const SCOPE_ARGUMENTS = new Set(['--uncommitted', '--committed', '--base', '--base-commit']);
const CONFIG_ARGUMENTS = new Set(['-c', '--config']);

function hasArgument(argumentsToCheck: readonly string[], acceptedArguments: ReadonlySet<string>): boolean {
  return argumentsToCheck.some((argument) => acceptedArguments.has(argument.split('=')[0] ?? argument));
}

/** Reads a stored review or the help text: no new review runs, so no review record follows. */
export function isStoredReviewCommand(rawArguments: readonly string[]): boolean {
  const suppliedArguments = rawArguments.filter((argument) => argument !== '--');
  return (
    suppliedArguments[0] === 'findings' ||
    suppliedArguments.includes('--show-prompts') ||
    suppliedArguments.includes('--help') ||
    suppliedArguments.includes('-h')
  );
}

export function buildCodeRabbitReviewArguments(rawArguments: readonly string[]): string[] {
  // Ignore the retired wrapper flag so historical commands still work.
  const suppliedArguments = rawArguments.filter(
    (argument) => argument !== '--' && argument !== '--approve-uncommitted',
  );

  if (isStoredReviewCommand(suppliedArguments)) {
    return ['review', ...suppliedArguments];
  }

  const reviewArguments: string[] = [];
  for (let index = 0; index < suppliedArguments.length; index += 1) {
    const argument = suppliedArguments[index];
    if (argument === undefined) break;
    const [name, ...inlineParts] = argument.split('=');
    if (name !== '--type' && name !== '-t') {
      reviewArguments.push(argument);
      continue;
    }
    const scope = inlineParts.length ? inlineParts.join('=') : suppliedArguments[++index];
    if (scope !== 'uncommitted' && scope !== 'committed') {
      throw new Error(
        'Legacy --type/-t requires committed or uncommitted. Use the current --committed or --uncommitted flags to select the review scope.',
      );
    }
    reviewArguments.push(`--${scope}`);
  }

  // CodeRabbit reviews the last --dir only, while the review record would claim every one.
  const directoryArguments = reviewArguments.filter((argument) => argument.split('=')[0] === '--dir');
  if (directoryArguments.length > 1) {
    throw new Error(
      'CodeRabbit reviews only the last --dir, so a review covers one directory per pass. Run one pass per directory.',
    );
  }

  const argumentsWithDefaults = ['review'];
  if (!reviewArguments.includes('--agent')) {
    argumentsWithDefaults.push('--agent');
  }
  if (!hasArgument(reviewArguments, SCOPE_ARGUMENTS)) {
    argumentsWithDefaults.push('--uncommitted');
  }
  if (
    (argumentsWithDefaults.includes('--uncommitted') || reviewArguments.includes('--uncommitted')) &&
    !reviewArguments.includes('--include-untracked')
  ) {
    argumentsWithDefaults.push('--include-untracked');
  }
  if (!hasArgument(reviewArguments, CONFIG_ARGUMENTS)) {
    argumentsWithDefaults.push('-c', 'AGENTS.md');
  }

  return [...argumentsWithDefaults, ...reviewArguments];
}

/** `coderabbit auth status --agent` exits 0 either way; only its status line says whether a review can run. */
export function isCodeRabbitAuthenticated(agentOutput: string): boolean {
  return agentOutput.split('\n').some((line) => {
    try {
      const status: unknown = JSON.parse(line);
      return (
        typeof status === 'object' &&
        status !== null &&
        'phase' in status &&
        status.phase === 'auth' &&
        'authenticated' in status &&
        status.authenticated === true
      );
    } catch {
      // A line that is not JSON is CLI chatter, never a status.
      return false;
    }
  });
}
