import { describe, expect, test } from 'bun:test';
import { enabledRuleNames, lintNameInForce, usedConfigBindings } from './lint-config';

describe('enabled rules', () => {
  test('a rule counts when one resolved file configuration enables it', () => {
    const enabled = enabledRuleNames([
      { rules: { 'no-console': ['error'], 'ui/no-raw-controls': 2, 'ui/off-rule': 'off' } },
      { rules: { 'ui/off-rule': 0, 'quality/function-size': 'warn' } },
      undefined,
    ]);
    expect([...enabled].sort()).toEqual(['no-console', 'quality/function-size', 'ui/no-raw-controls']);
  });
});

describe('configuration bindings', () => {
  const source = [
    "const registrySelectors = [{ selector: 'JSXOpeningElement', message: 'x' }];",
    "const unusedSelectors = [{ selector: 'X', message: 'y' }];",
    'function importRestrictions() { return {}; }',
    'export default [',
    "  { rules: { 'no-restricted-syntax': ['error', ...registrySelectors], 'no-restricted-imports': importRestrictions() } },",
    "  { linterOptions: { reportUnusedDisableDirectives: 'error', noInlineConfig: false } },",
    '];',
  ].join('\n');

  test('names used sets, used functions and linter options that are on', () => {
    const bindings = usedConfigBindings(source);
    expect(bindings.has('registrySelectors')).toBe(true);
    expect(bindings.has('importRestrictions')).toBe(true);
    expect(bindings.has('reportUnusedDisableDirectives')).toBe(true);
  });

  test('probe: a declared but unused set and a disabled linter option are no mechanism', () => {
    const bindings = usedConfigBindings(source);
    expect(bindings.has('unusedSelectors')).toBe(false);
    expect(bindings.has('noInlineConfig')).toBe(false);
  });
});

describe('lint names in force', () => {
  const enabled = new Set(['jsx-a11y/no-autofocus', 'ui/no-raw-controls']);
  const bindings = new Set(['registrySelectors']);

  test('an enabled rule, a used binding and the recommended set of an active plugin are in force', () => {
    expect(lintNameInForce('ui/no-raw-controls', enabled, bindings)).toBe(true);
    expect(lintNameInForce('registrySelectors', enabled, bindings)).toBe(true);
    expect(lintNameInForce('jsx-a11y/recommended', enabled, bindings)).toBe(true);
  });

  test('probe: a disabled rule, a name that only shares a prefix and a dead plugin set are not', () => {
    expect(lintNameInForce('ui/off-rule', enabled, bindings)).toBe(false);
    expect(lintNameInForce('ui/no-raw', enabled, bindings)).toBe(false);
    expect(lintNameInForce('react/recommended', enabled, bindings)).toBe(false);
  });
});
