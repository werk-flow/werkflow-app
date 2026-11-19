import { describe, expect, test } from 'bun:test';

import { toJob, type JobRow } from './types';

const STAMP = '2026-08-20T08:00:00.000Z';

const ROW: JobRow = {
  id: 'job-1',
  organization_id: 'org-1',
  project_id: null,
  client_id: null,
  job_number: 'A-100',
  source_number: null,
  title: 'Therme prüfen',
  description: null,
  status: 'nicht_bearbeitet',
  execution_state: null,
  execution_version: 0,
  priority: 'mittel',
  planned_date: null,
  planned_time: null,
  estimated_duration_minutes: null,
  planned_working_minutes: null,
  actual_completion_date: null,
  location: null,
  site_id: null,
  contact_id: null,
  created_by: 'user-1',
  created_at: STAMP,
  updated_at: STAMP,
};

describe('toJob', () => {
  // The job list sends every row to the browser; a null key per row grew the /auftraege payload past its lab ceiling.
  test('a job without a number in the previous system carries no sourceNumber key', () => {
    expect(Object.hasOwn(toJob(ROW), 'sourceNumber')).toBe(false);
  });

  test('a job with a number in the previous system carries it', () => {
    expect(toJob({ ...ROW, source_number: 'ALT-4711' }).sourceNumber).toBe('ALT-4711');
  });
});
