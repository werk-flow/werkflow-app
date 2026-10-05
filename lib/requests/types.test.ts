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
