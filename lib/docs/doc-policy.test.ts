import { describe, expect, test } from 'bun:test';
import { wordBudgetOf } from './doc-policy';

describe('documentation policy', () => {
  test('gives each budgeted file its budget', () => {
    expect(wordBudgetOf('AGENTS.md')).toBe(2800);
    expect(wordBudgetOf('docs/README.md')).toBe(3600);
    expect(wordBudgetOf('.claude/skills/x/SKILL.md')).toBe(4000);
    expect(wordBudgetOf('docs/technical/security.md')).toBe(4000);
    expect(wordBudgetOf('docs/features/inventory.md')).toBeNull();
  });
});
