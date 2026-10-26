// Rule test: CodeRabbit runs only through bun run review.
import { describe, expect, test } from 'bun:test';
import {
  buildCodeRabbitReviewArguments,
  codeRabbitBinary,
  findCodeRabbitInstructionViolations,
  isCodeRabbitAuthenticated,
  isStoredReviewCommand,
} from './coderabbit-review-command';

describe('CodeRabbit review command', () => {
  test('uses the repository defaults for an uncommitted agent review', () => {
    expect(buildCodeRabbitReviewArguments([])).toEqual([
      'review',
      '--agent',
      '--uncommitted',
      '--include-untracked',
      '-c',
      'AGENTS.md',
    ]);
  });

  test("accepts explicit local scope under the owner's standing authorization", () => {
    expect(buildCodeRabbitReviewArguments(['--type=uncommitted', '--include-untracked'])).toEqual([
      'review',
      '--agent',
      '-c',
      'AGENTS.md',
      '--uncommitted',
      '--include-untracked',
    ]);
    expect(buildCodeRabbitReviewArguments(['--approve-uncommitted'])).toEqual(
      buildCodeRabbitReviewArguments([]),
    );
  });

  test('keeps an explicit scope and context without adding conflicting defaults', () => {
    expect(
      buildCodeRabbitReviewArguments([
        '--',
        '--type',
        'committed',
        '--base-commit',
        'abc123',
        '-c',
        'AGENTS.md',
        '.coderabbit.yaml',
      ]),
    ).toEqual([
      'review',
      '--agent',
      '--committed',
      '--base-commit',
      'abc123',
      '-c',
      'AGENTS.md',
      '.coderabbit.yaml',
    ]);
  });

  test('keeps current committed and base scopes without adding local changes', () => {
    for (const scope of [['--committed'], ['--base', 'main'], ['--base-commit=abc123']]) {
      const argumentsForReview = buildCodeRabbitReviewArguments(scope);
      expect(argumentsForReview).toEqual(['review', '--agent', '-c', 'AGENTS.md', ...scope]);
      expect(argumentsForReview).not.toContain('--uncommitted');
      expect(argumentsForReview).not.toContain('--include-untracked');
    }
  });

  test('includes new files for current and legacy local scopes without duplicating flags', () => {
    expect(buildCodeRabbitReviewArguments(['--uncommitted'])).toEqual([
      'review',
      '--agent',
      '--include-untracked',
      '-c',
      'AGENTS.md',
      '--uncommitted',
    ]);
    expect(buildCodeRabbitReviewArguments(['-t', 'uncommitted', '--include-untracked'])).toEqual([
      'review',
      '--agent',
      '-c',
      'AGENTS.md',
      '--uncommitted',
      '--include-untracked',
    ]);
    expect(buildCodeRabbitReviewArguments(['--include-untracked'])).toEqual([
      'review',
      '--agent',
      '--uncommitted',
      '-c',
      'AGENTS.md',
      '--include-untracked',
    ]);
    expect(buildCodeRabbitReviewArguments(['-t=committed'])).toEqual([
      'review',
      '--agent',
      '-c',
      'AGENTS.md',
      '--committed',
    ]);
  });

  test('rejects missing or unsupported legacy scopes before sending code', () => {
    for (const scope of [
      ['--type'],
      ['--type='],
      ['-t', '--base', 'main'],
      ['--type=invalid'],
      ['--type', 'all'],
    ]) {
      expect(() => buildCodeRabbitReviewArguments(scope)).toThrow('Legacy --type/-t requires');
    }
  });

  test('refuses a second --dir, because CodeRabbit reviews only the last one', () => {
    expect(() => buildCodeRabbitReviewArguments(['--dir', 'lib', '--dir', 'app'])).toThrow(
      'one directory per pass',
    );
    expect(() => buildCodeRabbitReviewArguments(['--dir=lib', '--dir', 'app'])).toThrow(
      'one directory per pass',
    );
    expect(buildCodeRabbitReviewArguments(['--dir', 'lib'])).toContain('lib');
  });

  test('passes help through without configuring a review', () => {
    expect(buildCodeRabbitReviewArguments(['--', '--help'])).toEqual(['review', '--help']);
    expect(buildCodeRabbitReviewArguments(['--show-prompts'])).toEqual(['review', '--show-prompts']);
  });

  test.each([
    'coderabbit review --agent',
    'cr review --agent',
    'bunx coderabbit review --agent',
    'npx coderabbit review --agent',
    'sudo coderabbit review --agent',
    'env DEBUG=1 coderabbit review --agent',
    '/root/.local/bin/coderabbit review --agent',
    '~/.local/bin/coderabbit review --agent',
    '$HOME/.local/bin/coderabbit review --agent',
    '${HOME}/.local/bin/cr review --agent',
    '/usr/local/bin/cr review --agent',
    './cr review --agent',
  ])('detects the raw command bypass: %s', (command) => {
    expect(findCodeRabbitInstructionViolations(command)).toContain('raw-command');
  });

  test('detects installer instructions', () => {
    expect(
      findCodeRabbitInstructionViolations('curl -fsSL https://cli.coderabbit.ai/install.sh | sh'),
    ).toContain('installer');
  });

  test('allows wrapper commands and ordinary prose', () => {
    expect(findCodeRabbitInstructionViolations('CodeRabbit is installed. Run bun run review.')).toEqual([]);
  });

  test('replays stored findings without review-only defaults', () => {
    expect(buildCodeRabbitReviewArguments(['findings'])).toEqual(['review', 'findings']);
  });

  test("runs the CLI the installer put into the developer's own account", () => {
    expect(codeRabbitBinary('/home/someone')).toBe('/home/someone/.local/bin/coderabbit');
  });

  test('a review starts only after the agent status line reports an authenticated CLI', () => {
    expect(
      isCodeRabbitAuthenticated(
        '{"type":"status","phase":"auth","status":"authenticated","authenticated":true}\n',
      ),
    ).toBe(true);
    expect(
      isCodeRabbitAuthenticated(
        'Checking\n{"type":"status","phase":"auth","status":"not_authenticated","authenticated":false}',
      ),
    ).toBe(false);
    expect(isCodeRabbitAuthenticated('')).toBe(false);
  });
});

test('only a new review leaves a review record; reading stored findings or help does not', () => {
  for (const stored of [
    ['findings'],
    ['--', 'findings', '--severity', 'major'],
    ['--show-prompts'],
    ['--help'],
    ['-h'],
  ])
    expect(isStoredReviewCommand(stored)).toBe(true);
  for (const review of [[], ['--committed'], ['--base-commit', 'abc123'], ['--dir', 'lib']])
    expect(isStoredReviewCommand(review)).toBe(false);
});
