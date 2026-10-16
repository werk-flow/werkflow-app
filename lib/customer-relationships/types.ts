import type { ActionResult } from '@/lib/action-result';
import type { Database, Json } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import type { z } from '@/lib/zod';
import type { communicationPreferenceInputSchema, communicationSettingsInputSchema } from './schemas';

export const TIMELINE_PAGE_SIZE = 25;
export const FOLLOW_UP_PAGE_SIZE = 50;

export type TimelineCategory = 'work' | 'documents' | 'internal';

export type TimelineKind =
  | 'customer_created'
  | 'contact_created'
  | 'site_created'
  | 'request_received'
  | 'request_event'
  | 'request_closed'
  | 'request_converted'
  | 'job_created'
  | 'project_created'
  | 'document_linked'
  | 'follow_up_event'
  | 'communication_preference_event';

export type TimelineItem = {
  stableKey: string;
  kind: TimelineKind;
  category: TimelineCategory;
  sourceId: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  reference: string;
  detail: string | null;
  sourceHref: string | null;
  sourceAvailable: boolean;
  currentStateOnly: boolean;
  metadata: Json;
};

export type TimelinePage = {
  items: TimelineItem[];
  nextCursor: string | null;
};

const FOLLOW_UP_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
const FOLLOW_UP_SOURCE_TYPES = [
  'contact',
  'site',
  'request',
  'job',
  'project',
  'service_case',
  'maintenance_coverage',
] as const;
export type FollowUpSourceType = (typeof FOLLOW_UP_SOURCE_TYPES)[number];

export function toFollowUpStatus(value: string): FollowUpStatus {
  return constrainedValue(FOLLOW_UP_STATUSES, value, 'follow-up status');
}

export function toFollowUpSourceType(value: string): FollowUpSourceType {
  return constrainedValue(FOLLOW_UP_SOURCE_TYPES, value, 'follow-up source_type');
}

export type ClientFollowUp = {
  id: string;
  clientId: string;
  sourceType: FollowUpSourceType | null;
  sourceId: string | null;
  sourceLabel: string | null;
  sourceHref: string | null;
  title: string;
  note: string | null;
  ownerUserId: string;
  ownerName: string;
  ownerIsActiveManager: boolean;
  dueAt: string;
  status: FollowUpStatus;
  resolutionNote: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  completedBy: string | null;
  completedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
};

export type FollowUpOwner = {
  userId: string;
  name: string;
  role: 'admin' | 'buero';
};

const COMMUNICATION_CHANNELS = ['phone', 'email', 'sms', 'letter', 'in_person'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

const COMMUNICATION_PURPOSES = ['appointment_service', 'marketing', 'commercial_required'] as const;
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number];

const COMMUNICATION_PREFERENCE_STATES = ['allowed', 'disallowed', 'unknown'] as const;
export type CommunicationPreferenceState = (typeof COMMUNICATION_PREFERENCE_STATES)[number];

function toCommunicationChannel(value: string): CommunicationChannel {
  return constrainedValue(COMMUNICATION_CHANNELS, value, 'communication channel');
}

export type CommunicationSettings = {
  id: string;
  clientId: string;
  preferredContactId: string | null;
  preferredChannel: CommunicationChannel | null;
  doNotContactInstruction: string | null;
  contactTimeNote: string | null;
  languageNote: string | null;
  accessibilityNote: string | null;
  sourceNote: string | null;
  updatedBy: string;
  updatedAt: string;
};

export type CommunicationPreference = {
  id: string;
  clientId: string;
  contactId: string | null;
  channel: CommunicationChannel;
  purpose: CommunicationPurpose;
  state: CommunicationPreferenceState;
  sourceNote: string | null;
  updatedBy: string;
  updatedAt: string;
};

type Tables = Database['public']['Tables'];

export function settingsFromRow(row: Tables['client_communication_settings']['Row']): CommunicationSettings {
  return {
    id: row.id,
    clientId: row.client_id,
    preferredContactId: row.preferred_contact_id,
    preferredChannel: row.preferred_channel === null ? null : toCommunicationChannel(row.preferred_channel),
    doNotContactInstruction: row.do_not_contact_instruction,
    contactTimeNote: row.contact_time_note,
    languageNote: row.language_note,
    accessibilityNote: row.accessibility_note,
    sourceNote: row.source_note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export function preferenceFromRow(
  row: Tables['client_communication_preferences']['Row'],
): CommunicationPreference {
  return {
    id: row.id,
    clientId: row.client_id,
    contactId: row.contact_id,
    channel: toCommunicationChannel(row.channel),
    purpose: constrainedValue(COMMUNICATION_PURPOSES, row.purpose, 'communication purpose'),
    state: constrainedValue(COMMUNICATION_PREFERENCE_STATES, row.state, 'communication preference state'),
    sourceNote: row.source_note,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export type CommunicationWarningCode = 'do_not_contact' | 'wrong_contact' | 'disallowed_channel';

export type CommunicationGuidance = {
  state: CommunicationPreferenceState;
  source: 'contact' | 'customer' | 'unconfigured';
  warnings: CommunicationWarningCode[];
};

export type CustomerRelationshipBundle = {
  timeline: TimelinePage;
  followUps: ClientFollowUp[];
  followUpOwners: FollowUpOwner[];
  communicationSettings: CommunicationSettings | null;
  communicationPreferences: CommunicationPreference[];
};

export type { FollowUpInput } from './schemas';

export type CommunicationSettingsInput = z.infer<typeof communicationSettingsInputSchema>;

export type CommunicationPreferenceInput = z.infer<typeof communicationPreferenceInputSchema>;

export type RelationshipActionResult<T = undefined> = ActionResult<
  T extends undefined ? object : { data: T }
>;
