import { describe, expect, test } from 'bun:test';

import { Constants } from '@/lib/supabase/database.types';
import {
  followMappingVersion,
  invalidPayrollCodeKeys,
  PAYROLL_CODE_MAX_LENGTH,
  PAYROLL_CODE_ROWS,
  payrollCodesByKey,
  recordMappingSave,
  toPayrollCodeMappings,
} from './payroll-mapping';

const { payroll_mapping_value_kind: valueKinds, time_segment_kind: activityKinds } = Constants.public.Enums;

describe('PAYROLL_CODE_ROWS: the table lists every code the export requires', () => {
  test('every value kind once, and the credited time once per activity', () => {
    const required = [
      ...valueKinds.filter((kind) => kind !== 'credited_activity'),
      ...activityKinds.map((kind) => `credited_activity.${kind}`),
    ];
    expect(PAYROLL_CODE_ROWS.map((row) => row.key).toSorted()).toEqual(required.toSorted());
  });

  test('every row has a German label and a proposed code', () => {
    for (const row of PAYROLL_CODE_ROWS) {
      expect(row.label.trim()).not.toBe('');
      expect(row.defaultCode.trim()).not.toBe('');
    }
  });
});

describe('payrollCodesByKey: the form shows the codes in force', () => {
  test('before the first version it proposes the default codes', () => {
    const codes = payrollCodesByKey(null);
    for (const row of PAYROLL_CODE_ROWS) expect(codes[row.key]).toBe(row.defaultCode);
  });

  test('after a version it shows the stored codes and leaves a code the version lacks empty', () => {
    const codes = payrollCodesByKey([
      { value_kind: 'overtime', activity_kind: null, output_code: '1200' },
      { value_kind: 'credited_activity', activity_kind: 'standby', output_code: '1300' },
    ]);
    expect(codes.overtime).toBe('1200');
    expect(codes['credited_activity.standby']).toBe('1300');
    expect(codes.target).toBe('');
  });
});

describe('toPayrollCodeMappings: a confirmed mapping is complete', () => {
  const complete = payrollCodesByKey(null);

  test('a complete set becomes one trimmed code row per classification', () => {
    const mappings = toPayrollCodeMappings({ ...complete, overtime: '  1200 ' });
    expect(mappings).toHaveLength(PAYROLL_CODE_ROWS.length);
    expect(mappings).toContainEqual({ value_kind: 'overtime', activity_kind: null, output_code: '1200' });
    expect(mappings).toContainEqual({
      value_kind: 'credited_activity',
      activity_kind: 'work',
      output_code: 'ARBEIT',
    });
  });

  test('an empty, blank, missing or too long code refuses the whole set and names its rows', () => {
    const codes = {
      ...complete,
      target: '',
      vacation: '   ',
      overtime: 'X'.repeat(PAYROLL_CODE_MAX_LENGTH + 1),
      'credited_activity.callout': undefined,
    };
    expect(toPayrollCodeMappings(codes)).toBeNull();
    expect(invalidPayrollCodeKeys(codes)).toEqual([
      'target',
      'credited_activity.callout',
      'vacation',
      'overtime',
    ]);
  });
});

describe('followMappingVersion: a live refresh never erases unsaved codes', () => {
  const v1 = payrollCodesByKey(null);
  const v2 = { ...v1, overtime: 'UEB2' };
  const draft = { basedOnVersion: 1, readCodes: v1, codes: v1 };

  test('an untouched table shows the newer version', () => {
    expect(followMappingVersion(draft, { version: 2, codes: v2 })).toEqual({
      basedOnVersion: 2,
      readCodes: v2,
      codes: v2,
    });
  });

  test('a table with edits keeps them and the version they were read from, so its save is refused as stale', () => {
    const edited = { ...draft, codes: { ...v1, vacation: 'URL9' } };
    expect(followMappingVersion(edited, { version: 2, codes: v2 })).toBe(edited);
  });

  test('the own save arrives as the new version with the codes typed', () => {
    const saved = { ...draft, codes: v2 };
    expect(followMappingVersion(saved, { version: 2, codes: v2 }).basedOnVersion).toBe(2);
  });

  test('the same version changes nothing', () => {
    expect(followMappingVersion(draft, { version: 1, codes: v1 })).toBe(draft);
  });
});

describe('recordMappingSave: an edit typed during the own save stays based on that save', () => {
  const v1 = payrollCodesByKey(null);
  const submitted = { ...v1, overtime: 'UEB2' };
  // The Admin saved `submitted` from version 1 and typed one more code while the save ran.
  const typedDuringSave = { basedOnVersion: 1, readCodes: v1, codes: { ...submitted, vacation: 'URL9' } };

  test('the next save names the version this save committed and keeps the typed code', () => {
    const recorded = recordMappingSave(typedDuringSave, { version: 2, codes: submitted });
    expect(recorded).toEqual({ basedOnVersion: 2, readCodes: submitted, codes: typedDuringSave.codes });
    // The refresh that brings the own version 2 changes nothing.
    expect(followMappingVersion(recorded, { version: 2, codes: submitted })).toBe(recorded);
  });

  test('a version another session committed after the own save still leaves the edit stale', () => {
    const recorded = recordMappingSave(typedDuringSave, { version: 2, codes: submitted });
    const other = { ...submitted, sickness: 'KRANK2' };
    expect(followMappingVersion(recorded, { version: 3, codes: other }).basedOnVersion).toBe(2);
  });
});
