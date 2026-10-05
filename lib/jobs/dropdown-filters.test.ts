import { describe, expect, test } from 'bun:test';
import { applyDropdownFilters } from './dropdown-filters';
import { EMPTY_FILTER_STATE, type Job, type ProjectWithDetails, type UnifiedListEntry } from './types';

function buildFilterTestJob(id: string, clientId: string | null, plannedDate: string | null): Job {
  return {
    id,
    organizationId: 'org',
    projectId: null,
    clientId,
    jobNumber: null,
    title: id,
    description: null,
    status: 'nicht_bearbeitet',
    executionState: null,
    executionVersion: 1,
    priority: 'mittel',
    plannedDate,
    plannedTime: null,
    estimatedDurationMinutes: null,
    plannedWorkingMinutes: null,
    actualCompletionDate: null,
    location: null,
    siteId: null,
    contactId: null,
    createdBy: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function buildFilterTestProject(
  id: string,
  clientId: string | null,
  plannedStartDate: string | null,
): ProjectWithDetails {
  return {
    id,
    organizationId: 'org',
    clientId,
    name: id,
    description: null,
    projectNumber: null,
    statusOverride: null,
    executionStateOverride: null,
    executionVersion: 1,
    executionOverrideReason: null,
    plannedStartDate,
    plannedEndDate: null,
    siteId: null,
    contactId: null,
    createdBy: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    client: null,
    jobCount: 1,
    completedJobCount: 0,
    inProgressJobCount: 0,
    parkedJobCount: 0,
  };
}

const standalone: UnifiedListEntry = {
  type: 'standalone-job',
  job: buildFilterTestJob('job-1', 'client-a', '2026-03-10'),
};
const project: UnifiedListEntry = {
  type: 'project',
  project: buildFilterTestProject('project-1', null, null),
  childJobs: [buildFilterTestJob('job-2', 'client-b', '2026-04-01')],
};
const entries = [standalone, project];

function filteredEntryIds(result: UnifiedListEntry[]): string[] {
  return result.map((entry) => (entry.type === 'standalone-job' ? entry.job.id : entry.project.id));
}

describe('applyDropdownFilters', () => {
  test('keeps everything without active filters', () => {
    expect(applyDropdownFilters(entries, EMPTY_FILTER_STATE, {})).toEqual(entries);
  });

  test('filters by entry type', () => {
    expect(
      filteredEntryIds(applyDropdownFilters(entries, { ...EMPTY_FILTER_STATE, entryType: 'jobs' }, {})),
    ).toEqual(['job-1']);
    expect(
      filteredEntryIds(applyDropdownFilters(entries, { ...EMPTY_FILTER_STATE, entryType: 'projekte' }, {})),
    ).toEqual(['project-1']);
  });

  test('matches a project client through its child jobs', () => {
    const filters = { ...EMPTY_FILTER_STATE, clientIds: ['client-b'] };
    expect(filteredEntryIds(applyDropdownFilters(entries, filters, {}))).toEqual(['project-1']);
  });

  test('matches employees through the assignment map', () => {
    const filters = { ...EMPTY_FILTER_STATE, employeeIds: ['user-1'] };
    expect(filteredEntryIds(applyDropdownFilters(entries, filters, { 'job-2': ['user-1'] }))).toEqual([
      'project-1',
    ]);
    expect(applyDropdownFilters(entries, filters, {})).toEqual([]);
  });

  test('lets entries without a planned date pass the date range', () => {
    const filters = { ...EMPTY_FILTER_STATE, dateFrom: '2026-03-15', dateTo: '2026-12-31' };
    expect(filteredEntryIds(applyDropdownFilters(entries, filters, {}))).toEqual(['project-1']);
  });
});
