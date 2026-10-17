/**
 * Shell commands that would publish past the pre-push gate or switch it off: `git push --no-verify`,
 * a `core.hooksPath` override for one command (`git -c core.hooksPath= push`, `--config-env`, the
 * GIT_CONFIG_* variables) and a change of the clone's `core.hooksPath`. The prepared agent hook
 * `.claude/hooks/refuse-publication-bypass.ts` refuses them (audit finding B6, 2026-10-16); wiring it
 * into `.claude/settings.json` is the owner's act. The owner's own override stays
 * `WERKFLOW_PUSH_OVERRIDE`, which the hook logs.
 */
const GIT = String.raw`\bgit(?:\.exe)?\b`;
const BYPASSES: readonly { pattern: RegExp; reason: string }[] = [
  {
    // Git accepts any unambiguous prefix of a long option, so `--no-v` is `--no-verify`.
    pattern: new RegExp(
      String.raw`${GIT}[^|;&\n]*\bpush\b[^|;&\n]*\s--no-v(?:e(?:r(?:i(?:f(?:y)?)?)?)?)?(?![\w-])`,
    ),
    reason: 'git push --no-verify skips the publication gate',
  },
  {
    pattern: new RegExp(
      String.raw`${GIT}[^|;&\n]*\s(?:-c\s*["']?core\.hooksPath\b|--config-env[=\s]+["']?core\.hooksPath\b)`,
      'i',
    ),
    reason: 'a core.hooksPath override for one git command switches the publication gate off',
  },
  {
    pattern: /\bGIT_CONFIG_(?:PARAMETERS|COUNT|KEY_\d+)\b/,
    reason: 'GIT_CONFIG_* variables can override core.hooksPath and switch the publication gate off',
  },
  {
    pattern: new RegExp(
      String.raw`${GIT}[^|;&\n]*\bconfig\b(?!(?:\s+--(?:local|global|system))?\s+--get(?:-all)?\b)[^|;&\n]*\bcore\.hooksPath\b(?!\s+["']?\.githooks["']?\s*(?:$|[|;&\n]))`,
      'i',
    ),
    reason:
      'changing or unsetting core.hooksPath switches the publication gate off (the only allowed value is .githooks)',
  },
];

/** The reason a shell command would bypass the publication gate, or undefined. */
export function publicationBypass(command: string): string | undefined {
  return BYPASSES.find((bypass) => bypass.pattern.test(command))?.reason;
}
