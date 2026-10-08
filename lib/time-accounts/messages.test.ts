import { describe, expect, test } from 'bun:test';

import { SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { REALTIME_TABLES } from '@/lib/realtime/tables';
import { TIME_PERIOD_DETAIL_LIVE_TABLES, TIME_PERIOD_LIST_LIVE_TABLES } from './live-tables';
import {
  getClosePeriodFailureMessage,
  getTimeAccountFailureMessage,
  isTimeAccountFailureCode,
} from './messages';

describe('period close refusal', () => {
  test('a running session names every employee whose time still runs', () => {
    const message = getClosePeriodFailureMessage({
      success: false,
      error: 'period_open_sessions',
      employeeNames: ['Anna Berg', 'Ben Krüger'],
    });
    expect(message).toContain('Anna Berg und Ben Krüger');
    expect(message).toContain('Zeiterfassung läuft');
  });

  test('a running session without names still explains the refusal', () => {
    expect(getClosePeriodFailureMessage({ success: false, error: 'period_open_sessions' })).toContain(
      'solange eine Zeiterfassung läuft',
    );
  });

  test('invalid input and an already closed month take the shared sentences', () => {
    expect(getClosePeriodFailureMessage({ success: false, error: 'invalid_input' })).toBe(
      SHARED_FAILURE_MESSAGES.invalid_input,
    );
    expect(getClosePeriodFailureMessage({ success: false, error: 'period_closed' })).toBe(
      SHARED_FAILURE_MESSAGES.period_closed,
    );
  });

  test('only known database refusals pass through to the user', () => {
    expect(isTimeAccountFailureCode('close', 'period_open_sessions')).toBe(true);
    expect(isTimeAccountFailureCode('close', 'stale_calculation')).toBe(true);
    expect(isTimeAccountFailureCode('close', 'duplicate key value violates unique constraint')).toBe(false);
  });
});

describe('period form refusals', () => {
  test('each action accepts only its own codes', () => {
    expect(isTimeAccountFailureCode('prepare', 'stale_source_fingerprint')).toBe(true);
    expect(isTimeAccountFailureCode('reopen', 'period_order_conflict')).toBe(true);
    expect(isTimeAccountFailureCode('generateExport', 'missing_code_mapping')).toBe(true);
    expect(isTimeAccountFailureCode('downloadExport', 'export_not_ready')).toBe(true);
    expect(isTimeAccountFailureCode('reopen', 'stale_calculation')).toBe(false);
    expect(isTimeAccountFailureCode('decideFinding', 'permission denied for table')).toBe(false);
  });

  test('a failed responsibility read reads as a retry, not as a refusal', () => {
    for (const action of ['prepare', 'decideFinding', 'close', 'generateExport', 'downloadExport'] as const) {
      const message = getTimeAccountFailureMessage(action, 'responsibility_load_failed');
      expect(message).toContain('Versuche es');
      expect(message).not.toBe(getTimeAccountFailureMessage(action, 'forbidden'));
    }
  });

  test('a failed export read takes the shared load sentence, never "not ready" or "not closed"', () => {
    for (const action of ['generateExport', 'downloadExport'] as const) {
      expect(isTimeAccountFailureCode(action, 'load_failed')).toBe(true);
      expect(getTimeAccountFailureMessage(action, 'load_failed')).toBe(SHARED_FAILURE_MESSAGES.load_failed);
    }
  });

  test('every action has its own German sentence for a refusal and a fallback', () => {
    expect(getTimeAccountFailureMessage('prepare', 'prepare_failed')).toBe(
      'Die Periode konnte nicht vorbereitet werden. Versuche es erneut.',
    );
    expect(getTimeAccountFailureMessage('reopen', 'reason_required')).toBe(
      'Gib einen Grund für das Wiederöffnen an.',
    );
    expect(getTimeAccountFailureMessage('generateExport', 'mapping_not_configured')).toContain(
      'Lohnarten-Zuordnung',
    );
    expect(getTimeAccountFailureMessage('downloadExport', 'download_failed')).toBe(
      'Der Lohnexport konnte nicht heruntergeladen werden. Versuche es erneut.',
    );
  });

  test('invalid input and a closed month take the shared sentences', () => {
    expect(getTimeAccountFailureMessage('decideFinding', 'invalid_input')).toBe(
      SHARED_FAILURE_MESSAGES.invalid_input,
    );
    expect(getTimeAccountFailureMessage('prepare', 'period_closed')).toBe(
      SHARED_FAILURE_MESSAGES.period_closed,
    );
  });
});

describe('time-account settings refusals', () => {
  test('the database refusals of the settings RPCs pass through, raw messages do not', () => {
    expect(isTimeAccountFailureCode('decideAdjustment', 'not_responsible_or_self_approval')).toBe(true);
    expect(isTimeAccountFailureCode('decideAdjustment', 'request_not_pending')).toBe(true);
    expect(isTimeAccountFailureCode('submitAdjustment', 'stale_version')).toBe(true);
    expect(isTimeAccountFailureCode('openAccount', 'employee_not_found')).toBe(true);
    expect(isTimeAccountFailureCode('createMapping', 'employee_number_required')).toBe(true);
    expect(isTimeAccountFailureCode('assignPolicy', 'duplicate key value violates unique constraint')).toBe(
      false,
    );
  });

  test('the database role refusal takes the shared sentence', () => {
    expect(getTimeAccountFailureMessage('openAccount', 'not_authorized')).toBe(
      SHARED_FAILURE_MESSAGES.not_authorized,
    );
  });

  test('a stale account and a decided request tell the user to reload', () => {
    expect(getTimeAccountFailureMessage('submitAdjustment', 'stale_version')).toContain('Lade die Seite neu');
    expect(getTimeAccountFailureMessage('decideAdjustment', 'request_not_pending')).toContain(
      'bereits entschieden',
    );
  });

  test('every settings action has its own fallback', () => {
    expect(getTimeAccountFailureMessage('createPolicy', 'policy_save_failed')).toBe(
      'Die Regel konnte nicht gespeichert werden. Versuche es erneut.',
    );
    expect(getTimeAccountFailureMessage('createMapping', 'mapping_failed')).toBe(
      'Die Zuordnung konnte nicht gespeichert werden. Versuche es erneut.',
    );
  });
});

describe('period page live tables', () => {
  test('both period pages re-read on the published period root', () => {
    // decide_time_period_finding, prepare, close and reopen bump time_periods.
    expect(TIME_PERIOD_LIST_LIVE_TABLES).toContain('time_periods');
    expect(TIME_PERIOD_DETAIL_LIVE_TABLES).toContain('time_periods');
  });

  test('the detail re-reads when a blocking session starts or ends', () => {
    expect(TIME_PERIOD_DETAIL_LIVE_TABLES).toContain('time_sessions');
  });

  test('every table is published', () => {
    for (const table of TIME_PERIOD_DETAIL_LIVE_TABLES) expect(REALTIME_TABLES).toContain(table);
  });
});
