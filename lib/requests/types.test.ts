import { describe, expect, test } from 'bun:test';

import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CATEGORY_ORDER,
  REQUEST_CLOSE_REASON_LABELS,
  REQUEST_CLOSE_REASON_ORDER,
  REQUEST_SOURCE_LABELS,
  REQUEST_SOURCE_ORDER,
  REQUEST_URGENCY_LABELS,
  REQUEST_URGENCY_ORDER,
  REQUEST_ATTACHED_LABEL,
  describeAttachedRequestEvent,
  isCallbackOverdue,
  requestEquipmentOptions,
  requestUrgencyToJobPriority,
  toClientRequest,
  toClientRequestEvent,
  type ClientRequestEventRow,
  type ClientRequestRow,
} from './types';

const requestRow: ClientRequestRow = {
  id: 'request-1',
  organization_id: 'organization-1',
  request_number: 'AN-0001',
  client_id: 'client-1',
  contact_id: 'contact-1',
  site_id: 'site-1',
  equipment_id: 'equipment-1',
  attempt_key: null,
  caller_name: 'Erika Muster',
  caller_phone: '0301234567',
  caller_email: 'erika@example.test',
  caller_address: 'Hauptstraße 1',
  summary: 'Heizung fällt aus',
  details: 'Seit gestern',
  category: 'stoerung_reparatur',
  urgency: 'hoch',
  source: 'telefon',
  status: 'geschlossen',
  assigned_to: 'user-2',
  received_at: '2026-10-01T08:00:00.000Z',
  callback_due_at: '2026-10-01T10:00:00.000Z',
  closed_reason: 'duplikat',
  closed_note: 'Doppelt erfasst',
  closed_by: 'user-3',
  closed_at: '2026-10-02T08:00:00.000Z',
  converted_job_id: 'job-1',
  converted_project_id: 'project-1',
  converted_by: 'user-4',
  converted_at: '2026-10-03T08:00:00.000Z',
  created_by: 'user-1',
  created_at: '2026-10-01T07:00:00.000Z',
  updated_at: '2026-10-03T09:00:00.000Z',
};

const eventRow: ClientRequestEventRow = {
  id: 'event-1',
  organization_id: 'organization-1',
  request_id: 'request-1',
  event_type: 'closed',
  event_payload: { reason: 'duplikat' },
  created_by: 'user-3',
  created_at: '2026-10-02T08:00:00.000Z',
};

describe('requestUrgencyToJobPriority', () => {
  test('maps every urgency onto the job priority vocabulary, with Notfall as the highest job priority', () => {
    expect(REQUEST_URGENCY_ORDER.map(requestUrgencyToJobPriority)).toEqual([
      'niedrig',
      'mittel',
      'hoch',
      'hoch',
    ]);
  });
});

describe('request vocabulary', () => {
  test('each selection order lists every labelled value exactly once', () => {
    for (const [order, labels] of [
      [REQUEST_CATEGORY_ORDER, REQUEST_CATEGORY_LABELS],
      [REQUEST_URGENCY_ORDER, REQUEST_URGENCY_LABELS],
      [REQUEST_SOURCE_ORDER, REQUEST_SOURCE_LABELS],
      [REQUEST_CLOSE_REASON_ORDER, REQUEST_CLOSE_REASON_LABELS],
    ] as const) {
      expect<string[]>([...order].sort()).toEqual(Object.keys(labels).sort());
    }
  });
});

describe('toClientRequest', () => {
  test('carries every database column into its application field', () => {
    expect(toClientRequest(requestRow)).toEqual({
      id: 'request-1',
      organizationId: 'organization-1',
      requestNumber: 'AN-0001',
      clientId: 'client-1',
      contactId: 'contact-1',
      siteId: 'site-1',
      equipmentId: 'equipment-1',
      callerName: 'Erika Muster',
      callerPhone: '0301234567',
      callerEmail: 'erika@example.test',
      callerAddress: 'Hauptstraße 1',
      summary: 'Heizung fällt aus',
      details: 'Seit gestern',
      category: 'stoerung_reparatur',
      urgency: 'hoch',
      source: 'telefon',
      status: 'geschlossen',
      assignedTo: 'user-2',
      receivedAt: '2026-10-01T08:00:00.000Z',
      callbackDueAt: '2026-10-01T10:00:00.000Z',
      closedReason: 'duplikat',
      closedNote: 'Doppelt erfasst',
      closedBy: 'user-3',
      closedAt: '2026-10-02T08:00:00.000Z',
      convertedJobId: 'job-1',
      convertedProjectId: 'project-1',
      convertedBy: 'user-4',
      convertedAt: '2026-10-03T08:00:00.000Z',
      createdBy: 'user-1',
      createdAt: '2026-10-01T07:00:00.000Z',
      updatedAt: '2026-10-03T09:00:00.000Z',
    });
  });
});

describe('isCallbackOverdue', () => {
  const due = '2026-10-01T10:00:00.000Z';
  const afterDue = new Date('2026-10-01T10:00:01.000Z');
  test('an open or clarifying request is overdue once its promised callback has passed', () => {
    expect(isCallbackOverdue({ status: 'offen', callbackDueAt: due }, afterDue)).toBe(true);
    expect(isCallbackOverdue({ status: 'in_klaerung', callbackDueAt: due }, afterDue)).toBe(true);
    expect(isCallbackOverdue({ status: 'offen', callbackDueAt: due }, new Date(due))).toBe(false);
  });
  test('a request without a promise, or a converted or closed one, is never overdue', () => {
    expect(isCallbackOverdue({ status: 'offen', callbackDueAt: null }, afterDue)).toBe(false);
    expect(isCallbackOverdue({ status: 'umgewandelt', callbackDueAt: due }, afterDue)).toBe(false);
    expect(isCallbackOverdue({ status: 'geschlossen', callbackDueAt: due }, afterDue)).toBe(false);
  });
});

describe('requestEquipmentOptions', () => {
  const boiler = {
    id: 'equipment-1',
    equipmentNumber: 'ANL-1',
    name: 'Gaskessel',
    manufacturer: 'Hersteller',
    model: null,
    locationDetail: 'Keller',
  };
  test('offers the active Anlagen of the site', () => {
    expect(requestEquipmentOptions([boiler], '')).toEqual([
      { value: 'equipment-1', label: 'ANL-1 · Gaskessel', description: 'Hersteller · Keller' },
    ]);
    expect(requestEquipmentOptions([], '')).toEqual([]);
  });
  test('keeps a saved Anlage that is no longer active, so the form can clear it', () => {
    expect(requestEquipmentOptions([], 'archived-1')).toEqual([
      { value: 'archived-1', label: 'Bisherige Anlage (nicht mehr aktiv)' },
    ]);
    expect(requestEquipmentOptions([boiler], 'equipment-1')).toHaveLength(1);
  });
});

describe('toClientRequestEvent', () => {
  test('keeps an object payload', () => {
    expect(toClientRequestEvent(eventRow)).toEqual({
      id: 'event-1',
      organizationId: 'organization-1',
      requestId: 'request-1',
      eventType: 'closed',
      eventPayload: { reason: 'duplikat' },
      createdBy: 'user-3',
      createdAt: '2026-10-02T08:00:00.000Z',
    });
  });

  test('replaces a payload that is not an object with an empty one', () => {
    for (const payload of [null, ['duplikat'], 'duplikat', 3, true]) {
      expect(toClientRequestEvent({ ...eventRow, event_payload: payload }).eventPayload).toEqual({});
    }
  });
});

describe('a request added to existing work names that work and links to it', () => {
  test('a job, project or Servicefall reads by its kind and number and opens its detail page', () => {
    expect(
      describeAttachedRequestEvent({ target: 'job', workNumber: 'A-2026-0042', jobId: 'job-1' }),
    ).toEqual({ label: 'Zu Auftrag A-2026-0042 hinzugefügt', workHref: '/auftraege/A-2026-0042' });
    expect(
      describeAttachedRequestEvent({ target: 'project', workNumber: 'P-2026-0007', projectId: 'project-1' }),
    ).toEqual({ label: 'Zu Projekt P-2026-0007 hinzugefügt', workHref: '/auftraege/projekt/P-2026-0007' });
    expect(
      describeAttachedRequestEvent({ target: 'service_case', workNumber: 'SF-2026-0003', serviceCaseId: 'case-1' }),
    ).toEqual({ label: 'Zu Servicefall SF-2026-0003 hinzugefügt', workHref: '/service/faelle/SF-2026-0003' });
  });

  test('a payload without a readable work keeps the general label and links nowhere', () => {
    for (const payload of [null, {}, { target: 'offer', workNumber: 'X-1' }, { target: 'job', workNumber: 7 }]) {
      expect(describeAttachedRequestEvent(payload)).toEqual({ label: REQUEST_ATTACHED_LABEL, workHref: null });
    }
    expect(REQUEST_ATTACHED_LABEL).toBe('Zu bestehender Arbeit hinzugefügt');
  });
});
