import { describe, expect, test } from 'bun:test';
import { wordBudgetOf } from './doc-policy';

describe('documentation policy', () => {
  test('gives each budgeted file its budget', () => {
    expect(wordBudgetOf('AGENTS.md')).toBe(1800);
    expect(wordBudgetOf('docs/README.md')).toBe(800);
    expect(wordBudgetOf('.claude/skills/x/SKILL.md')).toBe(2700);
    expect(wordBudgetOf('docs/technical/security.md')).toBe(3000);
    expect(wordBudgetOf('docs/features/inventory.md')).toBeNull();
  });
});
