import { describe, expect, test } from 'bun:test';
import { readDocStatus } from './status-lines';

function doc(statusLine: string, second = ''): string {
  return ['# Title', second, statusLine, '', 'Body.'].join('\n');
}

describe('status lines', () => {
  test('reads the three genres and their dates', () => {
    expect(
      readDocStatus('technical/x.md', doc('Status: living — last reviewed 2026-10-17; a clause')),
    ).toEqual({
      status: { kind: 'living', date: '2026-10-17' },
    });
    expect(readDocStatus('plans/x.md', doc('Status: closed (2026-09-20) — history of X'))).toEqual({
      status: { kind: 'closed', date: '2026-09-20' },
    });
    expect(
      readDocStatus('decisions/0009-x.md', doc('- **Status:** accepted (2026-10-01) — implemented')),
    ).toEqual({
      status: { kind: 'accepted', date: '2026-10-01' },
    });
  });

  test('probe: a missing H1, a missing blank line and a malformed status each fail', () => {
    expect(readDocStatus('x.md', 'Title\n\nStatus: living — last reviewed 2026-10-17')).toEqual({
      problem: 'must start with an H1 on line 1',
    });
    expect(readDocStatus('x.md', doc('Status: living — last reviewed 2026-10-17', 'text'))).toEqual({
      problem: 'needs one blank line between the H1 and the status line',
    });
    const malformed = readDocStatus('x.md', doc('Status: living, reviewed recently'));
    expect('problem' in malformed && malformed.problem).toContain('line 3 must match');
    const decisionAsLiving = readDocStatus(
      'decisions/0009.md',
      doc('Status: living — last reviewed 2026-10-17'),
    );
    expect('problem' in decisionAsLiving).toBe(true);
  });
});
