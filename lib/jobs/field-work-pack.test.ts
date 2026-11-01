import { describe, expect, test } from 'bun:test';

import {
  isFieldWorkPackReadOnly,
  projectFieldWorkPackJob,
  sanitizeFieldInstructionItems,
} from './field-work-pack';
import type { JobInstructionItemWithDetails, JobWithDetails } from './types';
import { isTerminalWorkExecutionState } from '@/lib/work-lifecycle/types';

const STAMP = '2026-08-20T08:00:00.000Z';

// The job facts the field projection does not read; each test names the ones it checks.
const JOB_RECORD: JobWithDetails = {
  id: 'job',
  organizationId: 'org-1',
  projectId: null,
  clientId: null,
  jobNumber: null,
  title: '',
  description: null,
  status: 'nicht_bearbeitet',
  executionState: null,
  executionVersion: 0,
  priority: 'mittel',
  plannedDate: null,
  plannedTime: null,
  estimatedDurationMinutes: null,
  plannedWorkingMinutes: null,
  actualCompletionDate: null,
  location: null,
  siteId: null,
  contactId: null,
  createdBy: 'user-1',
  createdAt: STAMP,
  updatedAt: STAMP,
  assignments: [],
  client: null,
  project: null,
};

describe('field work pack projection', () => {
  test('projects only operational customer, site, contact, and parent reference facts', () => {
    const projected = projectFieldWorkPackJob({
      ...JOB_RECORD,
      id: 'job-1',
      jobNumber: 'A-100',
      title: 'Therme prüfen',
      description: 'Störung prüfen und Ursache dokumentieren',
      priority: 'hoch',
      plannedDate: '2026-08-24',
      plannedTime: '08:00:00',
      plannedWorkingMinutes: 120,
      location: 'Historische Adresse',
      client: {
        id: 'client-1',
        organizationId: 'org-1',
        name: 'Beispiel GmbH',
        clientType: 'gewerblich',
        customerNumber: null,
        phone: '+49123456',
        email: 'office@example.test',
        address: null,
        notes: 'Interne Kundenbewertung',
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      site: {
        id: 'site-1',
        name: 'Heizzentrale',
        street: 'Werkstraße 1',
        postalCode: '10115',
        city: 'Berlin',
        accessNotes: 'Pförtner ansprechen',
        notes: 'Interne Standortnotiz',
        organizationId: 'org-1',
        clientId: 'client-1',
        primaryContactId: null,
        isPrimary: true,
        isActive: true,
        createdBy: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      contact: {
        id: 'contact-1',
        organizationId: 'org-1',
        clientId: 'client-1',
        name: 'Kim Beispiel',
        role: 'Hausmeister/in',
        phone: '+49987654',
        email: 'kim@example.test',
        notes: 'Interne Kontaktnotiz',
        isPrimary: true,
        isActive: true,
        createdBy: null,
        createdAt: STAMP,
        updatedAt: STAMP,
      },
      project: { id: 'project-1', name: 'Sanierung Nord', projectNumber: 'P-20' },
      assignments: [
        {
          id: 'assignment-1',
          jobId: 'job-1',
          userId: 'user-3',
          assignedBy: 'user-1',
          assignedAt: STAMP,
          firstName: null,
          lastName: null,
          email: 'coworker@example.test',
          avatarPath: null,
        },
      ],
    });

    expect(projected).toEqual({
      id: 'job-1',
      jobNumber: 'A-100',
      title: 'Therme prüfen',
      requestedOutcome: 'Störung prüfen und Ursache dokumentieren',
      priority: 'hoch',
      plannedDate: '2026-08-24',
      plannedTime: '08:00:00',
      plannedWorkingMinutes: 120,
      customerName: 'Beispiel GmbH',
      customerPhone: '+49123456',
      siteName: 'Heizzentrale',
      siteAddress: 'Werkstraße 1, 10115 Berlin',
      accessNotes: 'Pförtner ansprechen',
      contactName: 'Kim Beispiel',
      contactRole: 'Hausmeister/in',
      contactPhone: '+49987654',
      project: { id: 'project-1', name: 'Sanierung Nord', projectNumber: 'P-20' },
    });
    expect(JSON.stringify(projected)).not.toContain('example.test');
    expect(JSON.stringify(projected)).not.toContain('Interne');
  });

  test('removes emails and avatars from instruction provenance', () => {
    const instruction: JobInstructionItemWithDetails = {
      id: 'item-1',
      organizationId: 'org-1',
      jobId: 'job-1',
      projectId: null,
      itemKind: 'task',
      requirementState: 'required',
      groupLabel: null,
      notes: null,
      templateApplicationId: null,
      sourceTemplateItemId: null,
      sortOrder: 0,
      isCompleted: false,
      completionVersion: 0,
      createdBy: 'user-1',
      createdAt: STAMP,
      updatedAt: STAMP,
      lastStatusChangedBy: 'user-2',
      lastStatusChangedAt: STAMP,
      content: 'Anlage absperren und prüfen',
      evidenceRequirements: [{ id: 'evidence-1', description: 'Foto', documentCategory: 'foto' }],
      predecessors: [{ id: 'predecessor-1', content: 'Zugang sichern' }],
      creator: {
        userId: 'user-1',
        firstName: 'Kim',
        lastName: 'Beispiel',
        email: 'kim@example.test',
        avatarPath: 'private/avatar.webp',
      },
      lastStatusChangedByProfile: {
        userId: 'user-2',
        firstName: 'Alex',
        lastName: 'Beispiel',
        email: 'alex@example.test',
        avatarPath: 'private/alex.webp',
      },
    };
    // An office-only field the instruction row may carry; the allow-list leaves it out.
    const item = { ...instruction, officeOnlyMargin: 1234 };

    const [sanitized] = sanitizeFieldInstructionItems([item]);
    if (!sanitized) throw new Error('Expected one sanitized instruction item');
    expect(sanitized.creator).toEqual({
      userId: 'user-1',
      firstName: 'Kim',
      lastName: 'Beispiel',
      email: null,
      avatarPath: null,
    });
    expect(sanitized.lastStatusChangedByProfile).toEqual({
      userId: 'user-2',
      firstName: 'Alex',
      lastName: 'Beispiel',
      email: null,
      avatarPath: null,
    });
    expect(JSON.stringify(sanitized)).not.toContain('@example.test');
    expect(JSON.stringify(sanitized)).not.toContain('private/');
    expect(sanitized.content).toBe('Anlage absperren und prüfen');
    expect(sanitized.evidenceRequirements).toEqual(item.evidenceRequirements);
    expect(sanitized.predecessors).toEqual(item.predecessors);
    expect(Object.keys(sanitized)).not.toContain('officeOnlyMargin');
  });

  test('uses the job location when no structured site exists', () => {
    const projected = projectFieldWorkPackJob({
      ...JOB_RECORD,
      id: 'job-location',
      jobNumber: 'A-101',
      title: 'Standort prüfen',
      description: null,
      priority: 'mittel',
      plannedDate: null,
      plannedTime: null,
      plannedWorkingMinutes: null,
      location: 'Werkhalle 3, Berlin',
      client: null,
      site: null,
      contact: null,
      project: null,
      assignments: [],
    });

    expect(projected.siteAddress).toBe('Werkhalle 3, Berlin');
    expect(projected.siteName).toBeNull();
  });

  test('does not expose an incomplete parent-project reference', () => {
    const projected = projectFieldWorkPackJob({
      ...JOB_RECORD,
      id: 'job-project',
      jobNumber: 'A-102',
      title: 'Anlage prüfen',
      description: null,
      priority: 'mittel',
      plannedDate: null,
      plannedTime: null,
      plannedWorkingMinutes: null,
      location: null,
      client: null,
      site: null,
      contact: null,
      project: { id: 'project-2', name: 'Projekt ohne Nummer', projectNumber: null },
      assignments: [],
    });

    expect(projected.project).toBeNull();
  });

  test('makes every post-execution state read-only for field workers', () => {
    expect(isFieldWorkPackReadOnly('not_started')).toBe(false);
    expect(isFieldWorkPackReadOnly('in_progress')).toBe(false);
    expect(isFieldWorkPackReadOnly('interrupted')).toBe(false);
    expect(isFieldWorkPackReadOnly('execution_complete')).toBe(true);
    expect(isFieldWorkPackReadOnly('handed_over')).toBe(true);
    expect(isFieldWorkPackReadOnly('cancelled')).toBe(true);
    expect(isTerminalWorkExecutionState('not_started')).toBe(false);
    expect(isTerminalWorkExecutionState('in_progress')).toBe(false);
    expect(isTerminalWorkExecutionState('interrupted')).toBe(false);
    expect(isTerminalWorkExecutionState('execution_complete')).toBe(true);
    expect(isTerminalWorkExecutionState('handed_over')).toBe(true);
    expect(isTerminalWorkExecutionState('cancelled')).toBe(true);
  });
});
