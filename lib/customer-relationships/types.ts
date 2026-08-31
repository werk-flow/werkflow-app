import type { Json } from '@/lib/supabase/database.types';
import type { z } from 'zod';
import type {
  communicationPreferenceInputSchema,
  communicationSettingsInputSchema,
} from './schemas';

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

export type FollowUpStatus = 'open' | 'completed' | 'cancelled';
export type FollowUpSourceType =
  | 'contact'
  | 'site'
  | 'request'
  | 'job'
  | 'project'
  | 'service_case'
  | 'maintenance_coverage';

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

export type CommunicationChannel =
  | 'phone'
  | 'email'
  | 'sms'
  | 'letter'
  | 'in_person';

export type CommunicationPurpose =
  | 'appointment_service'
  | 'marketing'
  | 'commercial_required';

export type CommunicationPreferenceState =
  | 'allowed'
  | 'disallowed'
  | 'unknown';

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

export type CommunicationWarningCode =
  | 'do_not_contact'
  | 'wrong_contact'
  | 'disallowed_channel';

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

export type CommunicationSettingsInput = z.infer<
  typeof communicationSettingsInputSchema
>;

export type CommunicationPreferenceInput = z.infer<
  typeof communicationPreferenceInputSchema
>;

export type RelationshipActionResult<T = undefined> =
  | (T extends undefined ? { success: true } : { success: true; data: T })
  | { success: false; error: string };
