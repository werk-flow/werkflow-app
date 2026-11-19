import { describe, expect, test } from 'bun:test';

import {
  JOB_ROW_CONTENT_CHECKS,
  PROJECT_ROW_CONTENT_CHECKS,
  TABLE_ROW_CONTENT_CHECKS,
} from '@/components/auftraege/list/unified-auftraege-row-memo';
import type { AuftraegeColumnId } from '@/lib/jobs/auftraege-table-columns';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';
import { memoPropsEqual, sameFields, sameItems, sameRecords } from './memo-equality';

// Tier 2 for the memoized rows (performance.md, "Improve a flow"): a row
// keeps its render only while everything it shows is unchanged. A route
// render rebuilds every row's values, so the content checks must accept an
// equal rebuild and refuse any changed shown field.

describe('memoPropsEqual', () => {
  type Props = { id: string; tags: string[]; onOpen: () => void; note?: string | undefined };
  const sameProps = memoPropsEqual<Props>({ tags: (previous, next) => sameItems(previous.tags, next.tags) });
  const onOpen = (): void => undefined;
  const props: Props = { id: 'a', tags: ['x'], onOpen };

  test('accepts identical props and a rebuilt value its content check accepts', () => {
    expect(sameProps(props, { ...props })).toBe(true);
    expect(sameProps(props, { ...props, tags: ['x'] })).toBe(true);
  });

  test('refuses a changed prop without a check, a refused check and a prop on one side only', () => {
    expect(sameProps(props, { ...props, onOpen: () => undefined })).toBe(false);
    expect(sameProps(props, { ...props, id: 'b' })).toBe(false);
    expect(sameProps(props, { ...props, tags: ['y'] })).toBe(false);
    expect(sameProps(props, { ...props, note: undefined })).toBe(false);
  });
});

describe('sameFields', () => {
  test('compares flat fields, lists item by item and nested objects by identity', () => {
    const nested = { street: 'Hauptstraße 1' };
    expect(sameFields({ a: 1, list: ['x'], nested }, { a: 1, list: ['x'], nested })).toBe(true);
    expect(sameFields({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameFields<{ a: number; b?: number }>({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameFields({ list: ['x'] }, { list: ['y'] })).toBe(false);
    expect(sameFields({ nested }, { nested: { ...nested } })).toBe(false);
  });

  test('a missing record equals only another missing one', () => {
    expect(sameFields(undefined, undefined)).toBe(true);
    expect(sameFields({ a: 1 }, undefined)).toBe(false);
    expect(sameFields(null, { a: 1 })).toBe(false);
  });

  test('a map, a set or a list equals only itself, never by its empty own fields', () => {
    expect(sameFields(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false);
    expect(sameFields(new Set(['a']), new Set(['a']))).toBe(false);
    expect(sameFields(['a'], ['a'])).toBe(false);
  });
});

test('sameItems and sameRecords compare in order', () => {
  expect(sameItems(['a', 'b'], ['a', 'b'])).toBe(true);
  expect(sameItems(['a', 'b'], ['b', 'a'])).toBe(false);
  expect(sameRecords([{ a: 1 }], [{ a: 1 }])).toBe(true);
  expect(sameRecords([{ a: 1 }], [{ a: 1 }, { a: 2 }])).toBe(false);
  expect(sameRecords([{ a: 1 }], [{ a: 3 }])).toBe(false);
});

const job: Job = {
  id: 'job-1',
  organizationId: 'org-1',
  projectId: null,
  clientId: 'client-1',
  jobNumber: 'AUF-1',
  title: 'Heizung warten',
  description: null,
  status: 'nicht_bearbeitet',
  executionState: null,
  executionVersion: 1,
  priority: 'mittel',
  plannedDate: '2026-10-05',
  plannedTime: null,
  estimatedDurationMinutes: null,
  plannedWorkingMinutes: null,
  actualCompletionDate: null,
  location: null,
  siteId: null,
  contactId: null,
  createdBy: 'user-1',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-01T08:00:00Z',
};

const project: ProjectWithDetails = {
  id: 'project-1',
  organizationId: 'org-1',
  clientId: 'client-1',
  name: 'Neubau',
  description: null,
  projectNumber: 'PRJ-1',
  statusOverride: null,
  executionStateOverride: null,
  executionVersion: 1,
  executionOverrideReason: null,
  plannedStartDate: null,
  plannedEndDate: null,
  siteId: null,
  contactId: null,
  createdBy: 'user-1',
  createdAt: '2026-10-01T08:00:00Z',
  updatedAt: '2026-10-01T08:00:00Z',
  client: null,
  jobCount: 1,
  completedJobCount: 0,
  inProgressJobCount: 0,
  parkedJobCount: 0,
};

/** Each field of a record, changed: a row showing the record must render again for every one. */
function changedFields<Shape extends object>(record: Shape): Shape[] {
  return Object.keys(record).map((key) => ({ ...record, [key]: `changed ${key}` }));
}

describe('an Aufträge job row', () => {
  type JobRowProps = {
    job: Job;
    assignedUserIds: string[];
    project?: ProjectWithDetails | undefined;
    visibleColumns: AuftraegeColumnId[];
    isSettling: boolean;
  };
  const sameJobRow = memoPropsEqual<JobRowProps>({ ...JOB_ROW_CONTENT_CHECKS, ...TABLE_ROW_CONTENT_CHECKS });
  const previous: JobRowProps = {
    job,
    assignedUserIds: ['user-1'],
    project,
    visibleColumns: ['nr', 'bezeichnung'],
    isSettling: false,
  };

  test('keeps its render through a route render that rebuilt equal values', () => {
    const next: JobRowProps = {
      ...previous,
      job: { ...job },
      assignedUserIds: ['user-1'],
      project: { ...project },
      visibleColumns: ['nr', 'bezeichnung'],
    };
    expect(sameJobRow(previous, next)).toBe(true);
  });

  test('renders again for every changed job field and project field', () => {
    for (const changedJob of changedFields(job))
      expect(sameJobRow(previous, { ...previous, job: changedJob })).toBe(false);
    for (const changedProject of changedFields(project))
      expect(sameJobRow(previous, { ...previous, project: changedProject })).toBe(false);
  });

  test('renders again for changed assignees, columns, settling marker or parent project', () => {
    expect(sameJobRow(previous, { ...previous, assignedUserIds: ['user-1', 'user-2'] })).toBe(false);
    expect(sameJobRow(previous, { ...previous, visibleColumns: ['nr'] })).toBe(false);
    expect(sameJobRow(previous, { ...previous, isSettling: true })).toBe(false);
    expect(sameJobRow(previous, { ...previous, project: undefined })).toBe(false);
  });
});

describe('an Aufträge project row', () => {
  type ProjectRowProps = {
    project: ProjectWithDetails;
    childJobs: Job[];
    projectAssignedUserIds?: string[] | undefined;
    clientMap: Record<string, string>;
    jobAssignmentMap: Record<string, string[]>;
    jobs: Job[];
  };
  const sameProjectRow = memoPropsEqual<ProjectRowProps>(PROJECT_ROW_CONTENT_CHECKS);
  const previous: ProjectRowProps = {
    project,
    childJobs: [job],
    projectAssignedUserIds: ['user-1'],
    clientMap: { 'client-1': 'Müller GmbH' },
    jobAssignmentMap: { 'job-1': ['user-1'] },
    jobs: [job],
  };

  test('keeps its render through a route render that rebuilt equal values', () => {
    const next: ProjectRowProps = {
      project: { ...project },
      childJobs: [{ ...job }],
      projectAssignedUserIds: ['user-1'],
      clientMap: { 'client-1': 'Müller GmbH' },
      jobAssignmentMap: { 'job-1': ['user-1'] },
      jobs: [{ ...job }],
    };
    expect(sameProjectRow(previous, next)).toBe(true);
  });

  test('renders again for each changed shown value', () => {
    const changedJob = { ...job, title: 'Heizung tauschen' };
    const changes: ProjectRowProps[] = [
      { ...previous, project: { ...project, jobCount: 2 } },
      { ...previous, childJobs: [changedJob] },
      { ...previous, projectAssignedUserIds: undefined },
      { ...previous, clientMap: { 'client-1': 'Schulz KG' } },
      { ...previous, jobAssignmentMap: { 'job-1': ['user-2'] } },
      { ...previous, jobs: [job, changedJob] },
    ];
    for (const next of changes) expect(sameProjectRow(previous, next)).toBe(false);
  });
});
