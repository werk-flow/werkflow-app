import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DATED_LINES,
  findPolicyDifferences,
  policyRows,
  readDecisionPolicy,
  wordBudgetOf,
} from './doc-policy';
import { findDatedLines } from './living-doc-rules';

const decisionPath = resolve(import.meta.dir, '../../docs/decisions/0004-documentation-structure.md');

describe('documentation policy', () => {
  test('equals the settings table of the latest amendment to decision 0004', () => {
    const decided = readDecisionPolicy(readFileSync(decisionPath, 'utf8'));
    expect(decided).not.toBeNull();
    expect(findPolicyDifferences(policyRows(), decided ?? [])).toEqual([]);
  });

  test('probe: a raised budget or an added exemption differs from the table', () => {
    const decided = [
      { setting: 'Word budget: AGENTS.md', value: '2800' },
      { setting: 'Dated doc', value: 'docs/plans/phase-1/log.md' },
    ];
    expect(
      findPolicyDifferences(
        [
          { setting: 'Word budget: AGENTS.md', value: '3000' },
          { setting: 'Dated doc', value: 'docs/plans/phase-1/log.md' },
          { setting: 'Dated doc', value: 'docs/technical/security.md' },
        ],
        decided,
      ),
    ).toEqual([
      'lib/docs/doc-policy.ts has "Word budget: AGENTS.md = 3000", which the latest decision table does not',
      'lib/docs/doc-policy.ts has "Dated doc = docs/technical/security.md", which the latest decision table does not',
      'the latest decision table has "Word budget: AGENTS.md = 2800", which lib/docs/doc-policy.ts does not',
    ]);
  });

  test('reads only the last settings table, with or without backticks', () => {
    const markdown = [
      '| Setting | Value | Reason |',
      '| --- | --- | --- |',
      '| Word budget: AGENTS.md | 2700 | old |',
      '',
      '| Setting | Value | Reason |',
      '| --- | --- | --- |',
      '| Word budget: AGENTS.md | 2800 | new |',
      '| Unmirrored skill | `coderabbit-review` | why |',
      '',
      'Text after the table.',
    ].join('\n');
    expect(readDecisionPolicy(markdown)).toEqual([
      { setting: 'Word budget: AGENTS.md', value: '2800' },
      { setting: 'Unmirrored skill', value: 'coderabbit-review' },
    ]);
    expect(readDecisionPolicy('no table')).toBeNull();
  });

  test('gives each budgeted file its budget', () => {
    expect(wordBudgetOf('AGENTS.md', false)).toBe(2800);
    expect(wordBudgetOf('docs/README.md', true)).toBe(3600);
    expect(wordBudgetOf('.claude/skills/x/SKILL.md', false)).toBe(4000);
    expect(wordBudgetOf('docs/technical/security.md', true)).toBe(4000);
    expect(wordBudgetOf('docs/technical/test-incident-log.md', true)).toBeNull();
    expect(wordBudgetOf('docs/features/inventory.md', true)).toBeNull();
    expect(wordBudgetOf('docs/technical/security.md', false)).toBeNull();
  });

  test('lets only the expiry column of a credential row carry a date in environments.md', () => {
    const markdown = [
      '# Environments',
      '',
      'Status: living — last reviewed 2026-10-26',
      '| `VERCEL_TOKEN` | GitHub repository secret | Staging deploys | 2027-10-26 | `vercel-token` | Rotate it. |',
      '| `VERCEL_TOKEN` | GitHub repository secret | Rotated on 2026-10-26 | Never | `vercel-token` | Rotate it. |',
      '| `FOO` | 2027-01-01 |',
      '| `SUPABASE_ACCESS_TOKEN` | GitHub repository secret | Rotated on 2026-10-26 | 2027-10-26 | `x` | Rotate it. |',
      'The token expires on 2027-10-26.',
    ].join('\n');
    expect(findDatedLines(markdown, DATED_LINES['docs/technical/environments.md'])).toEqual([5, 6, 7, 8]);
  });
});
