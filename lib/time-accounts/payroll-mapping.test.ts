import { describe, expect, test } from 'bun:test';

import { Constants } from '@/lib/supabase/database.types';
import {
  invalidPayrollCodeKeys,
  PAYROLL_CODE_MAX_LENGTH,
  PAYROLL_CODE_ROWS,
  payrollCodesByKey,
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
