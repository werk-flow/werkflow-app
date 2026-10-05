import { describe, expect, test } from 'bun:test';
import type { DocumentLink, OrganizationDocument } from '@/lib/documents/types';
import type { Client, Job, ProjectWithDetails } from '@/lib/jobs/types';
import {
  buildWorkContextGroups,
  getJobHref,
  getLatestUpdatedAt,
  getProjectHref,
} from './work-context-groups';

const timestamp = '2026-10-01T08:00:00.000Z';

function link(
  target: Partial<Pick<DocumentLink, 'jobId' | 'projectId' | 'clientId' | 'employeeId'>>,
): DocumentLink {
  return {
    id: `link-${JSON.stringify(target)}`,
    organizationId: 'org',
    documentId: 'document',
    jobId: null,
    projectId: null,
    clientId: null,
    employeeId: null,
    requestId: null,
    equipmentId: null,
    serviceCaseId: null,
    maintenanceCoverageId: null,
    jobTitle: null,
    jobNumber: null,
    projectName: null,
    projectNumber: null,
    clientName: null,
    employeeName: null,
    employeeEmail: null,
    requestNumber: null,
    requestSummary: null,
    equipmentNumber: null,
    equipmentName: null,
    serviceCaseNumber: null,
    serviceCaseSummary: null,
    maintenanceCoverageNumber: null,
    createdBy: 'user',
    createdAt: timestamp,
    ...target,
  };
}

function document(id: string, links: DocumentLink[], updatedAt = timestamp): OrganizationDocument {
  return {
    id,
    organizationId: 'org',
    folderId: null,
    category: 'other',
    storageBucket: 'documents',
    storagePath: `org/${id}`,
    originalFileName: `${id}.pdf`,
    displayName: id,
    mimeType: null,
    sizeBytes: 1,
    uploadedBy: 'user',
    copiedFromDocumentId: null,
    currentVersionNumber: 1,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    metadata: {},
    createdAt: timestamp,
    updatedAt,
    uploader: null,
    links,
  };
}

function job(id: string, projectId: string | null, jobNumber: string | null = `A-${id}`): Job {
  return {
    id,
    organizationId: 'org',
    projectId,
    clientId: null,
    jobNumber,
    title: id,
    description: null,
    status: 'nicht_bearbeitet',
    executionState: null,
    executionVersion: 1,
    priority: 'mittel',
    plannedDate: null,
    plannedTime: null,
    estimatedDurationMinutes: null,
    plannedWorkingMinutes: null,
    actualCompletionDate: null,
    location: null,
    siteId: null,
    contactId: null,
    createdBy: 'user',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function project(id: string, projectNumber: string | null = `P-${id}`): ProjectWithDetails {
  return {
    id,
    organizationId: 'org',
    clientId: null,
    name: id,
    description: null,
    projectNumber,
    statusOverride: null,
    executionStateOverride: null,
    executionVersion: 1,
    executionOverrideReason: null,
    plannedStartDate: null,
    plannedEndDate: null,
    siteId: null,
    contactId: null,
    createdBy: 'user',
    createdAt: timestamp,
    updatedAt: timestamp,
    client: null,
    jobCount: 0,
    completedJobCount: 0,
    inProgressJobCount: 0,
    parkedJobCount: 0,
  };
}

const client: Client = {
  id: 'client',
  organizationId: 'org',
  name: 'Familie Berg',
  clientType: 'privat',
  customerNumber: null,
  email: null,
  phone: null,
  address: null,
  notes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('buildWorkContextGroups', () => {
  const projectOne = project('project');
  const childJob = job('child', 'project');
  const standaloneJob = job('standalone', null);
  const orphanJob = job('orphan', 'unknown-project');
  const documents = [
    document('project-plan', [link({ projectId: 'project' }), link({ projectId: 'project' })]),
    document('child-photo', [link({ jobId: 'child' })]),
    document('standalone-report', [link({ jobId: 'standalone' }), link({ clientId: 'client' })]),
    document('orphan-note', [link({ jobId: 'orphan' })]),
    document('employee-certificate', [link({ employeeId: 'employee' })]),
    document('foreign', [link({ jobId: 'not-loaded' })]),
  ];
  const groups = buildWorkContextGroups({
    documents,
    jobs: [childJob, standaloneJob, orphanJob],
    projects: [projectOne, project('empty-project')],
    clients: [client],
    employees: [{ userId: 'employee', name: '', email: 'monteur@example.com' }],
  });

  test('a project groups its own documents once and its child jobs with documents', () => {
    expect(groups.projectGroups).toHaveLength(1);
    const [projectGroup] = groups.projectGroups;
    expect(projectGroup?.directDocuments.map((entry) => entry.id)).toEqual(['project-plan']);
    expect(projectGroup?.childJobGroups.map((group) => group.job.id)).toEqual(['child']);
    expect(projectGroup?.totalDocumentCount).toBe(2);
  });

  test('a job outside a loaded project is standalone', () => {
    expect(groups.standaloneJobGroups.map((group) => group.job.id)).toEqual(['standalone', 'orphan']);
  });

  test('clients and employees get titled, linked groups', () => {
    expect(groups.clientGroups).toEqual([
      {
        id: 'client',
        title: 'Familie Berg',
        typeLabel: 'Kunde',
        href: '/kunden/client',
        documents: documents.slice(2, 3),
      },
    ]);
    expect(groups.employeeGroups.map(({ title, href }) => ({ title, href }))).toEqual([
      { title: 'monteur@example.com', href: '/mitarbeiter/employee' },
    ]);
  });
});

describe('document work context helpers', () => {
  test('the latest update wins', () => {
    expect(
      getLatestUpdatedAt([
        document('old', [], '2026-09-01T08:00:00.000Z'),
        document('new', [], '2026-10-01T09:00:00.000Z'),
      ]),
    ).toBe('2026-10-01T09:00:00.000Z');
    expect(getLatestUpdatedAt([])).toBeNull();
  });

  test('hrefs need a number and nest a job under its numbered project', () => {
    expect(getProjectHref(project('p', 'P 1'))).toBe('/auftraege/projekt/P%201');
    expect(getProjectHref(project('p', null))).toBeNull();
    expect(getJobHref({ job: job('j', 'p', 'A-1'), project: project('p', 'P-1') })).toBe(
      '/auftraege/projekt/P-1/A-1',
    );
    expect(getJobHref({ job: job('j', null, 'A-1') })).toBe('/auftraege/A-1');
    expect(getJobHref({ job: job('j', null, null) })).toBeNull();
  });
});
