import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  CALENDAR_REFUSAL_CODES,
  calendarRefusalMessage,
  calendarUndoFailureMessage,
  formatRefusalDate,
  isCalendarRefusalCode,
} from './messages';

// Tier 2 for criterion 27: the message map is checked against the actual
// result codes of the modules the calendar calls, and no calendar component
// may render an action's error code as text.

const repositoryRoot = resolve(import.meta.dir, '../..');

// Every 'use server' module a calendar component or the calendar reads call,
// plus the helpers whose codes those actions pass through.
const CALENDAR_ACTION_MODULES = [
  'lib/jobs/actions.ts',
  'lib/jobs/auth.ts',
  'lib/planning/actions.ts',
  'lib/work-lifecycle/actions.ts',
  'lib/time-tracking/actions.ts',
  'lib/calendar/actions.ts',
  'lib/calendar/client.ts',
  'lib/calendar/action-result.ts',
  'lib/parking/actions.ts',
];

function scanActionCodes(): Set<string> {
  const codes = new Set<string>();
  for (const file of CALENDAR_ACTION_MODULES) {
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const match of source.matchAll(/error:\s*['"]([a-z_]+)['"]/g)) codes.add(match[1] ?? '');
    // The work-lifecycle mapper lists the database codes it forwards verbatim.
    const known = /function mapWorkError[\s\S]*?const known = \[([\s\S]*?)\]/.exec(source);
    for (const match of (known?.[1] ?? '').matchAll(/['"]([a-z_]+)['"]/g)) codes.add(match[1] ?? '');
  }
  codes.delete('');
  return codes;
}

describe('calendar message map', () => {
  test('carries a sentence for every result code the calendar-reachable actions return', () => {
    const missing = [...scanActionCodes()].filter((code) => !isCalendarRefusalCode(code)).sort();
    expect(missing).toEqual([]);
  });

  test('every sentence is German prose that names a next step, or an explicit dialog-owned null', () => {
    for (const code of CALENDAR_REFUSAL_CODES) {
      const sentence = calendarRefusalMessage(code, { name: 'Sven Neumann', date: '18.9.' });
      if (sentence === null) {
        expect(['planning_warning', 'qualification_warning', 'qualification_declined', 'no_changes']).toContain(code);
        continue;
      }
      expect(sentence.length, code).toBeGreaterThan(20);
      expect(sentence, code).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(sentence, code).toMatch(/\.$/);
    }
  });

  test('fills the person and the date into the sentences that name them', () => {
    expect(calendarRefusalMessage('person_absent', { name: 'Sven Neumann', date: '18.9.' })).toBe(
      'Sven Neumann ist am 18.9. abwesend. Wähle einen anderen Tag oder eine andere Person.',
    );
    expect(calendarRefusalMessage('overlapping_session', {})).toContain('Diese Person hat');
  });

  test('passes a server sentence through, never renders an unknown code, and prefixes undo failures', () => {
    const serverSentence = 'Zeitstempel kann nicht in der Zukunft liegen.';
    expect(calendarRefusalMessage(serverSentence)).toBe(serverSentence);
    expect(calendarRefusalMessage('some_new_code')).not.toContain('some_new_code');
    expect(calendarUndoFailureMessage('overlapping_session', { name: 'Mia' })).toBe(
      'Rückgängig war nicht möglich: Mia hat in diesem Zeitraum bereits Arbeitszeit. Wähle eine freie Zeit oder eine andere Person.',
    );
    expect(formatRefusalDate('2026-09-08')).toBe('8.9.');
  });

  test('no calendar component renders a result code as text', () => {
    const offenders: string[] = [];
    function visit(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { visit(path); continue; }
        if (!entry.name.endsWith('.tsx')) continue;
        const source = readFileSync(path, 'utf8');
        // A raw code reaches the user through `{result.error}`, `message: result.error`
        // or a `?? error` fallback; the message layer is the only allowed route.
        if (/\{\s*\w+\.error\s*\}|message:\s*\w+\.error\s*[,}]|\?\?\s*\w+\.error\s*[,;)}]|return\s+error;/.test(source)) {
          offenders.push(path.slice(repositoryRoot.length + 1));
        }
      }
    }
    visit(resolve(repositoryRoot, 'components/kalender'));
    expect(offenders).toEqual([]);
  });
});
