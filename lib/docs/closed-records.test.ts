import { describe, expect, test } from 'bun:test';
import { CLOSED_RECORD_BANNER, hasClosedRecordBanner } from './closed-records';

const head = [
  '# P1-13 — Work templates',
  '',
  'Status: closed (2026-08-23) — accepted P1-13 acceptance record',
  '',
];

describe('closed record banner', () => {
  test('a closed record with the banner under its status line passes', () => {
    expect(
      hasClosedRecordBanner([...head, CLOSED_RECORD_BANNER, '', '## Plan', '- Add the schema.'].join('\n')),
    ).toBe(true);
    expect(hasClosedRecordBanner([...head, CLOSED_RECORD_BANNER, ''].join('\r\n'))).toBe(true);
  });

  test('a record without the banner, with an edited banner or with the banner further down fails', () => {
    expect(hasClosedRecordBanner([...head, '## Plan', '- Add the schema.'].join('\n'))).toBe(false);
    expect(hasClosedRecordBanner([...head, '> This record is history.', ''].join('\n'))).toBe(false);
    expect(hasClosedRecordBanner([...head, 'Intro.', '', CLOSED_RECORD_BANNER, ''].join('\n'))).toBe(false);
  });
});
