import { isJsonRecord } from '@/lib/supabase/json';
import { isUuid } from '@/lib/validation/uuid';
import type {
  CommunicationChannel,
  CommunicationGuidance,
  CommunicationPreference,
  CommunicationPurpose,
  CommunicationSettings,
  TimelineItem,
  TimelineKind,
  TimelinePage,
} from './types';

type TimelineCursor = {
  version: 1;
  occurredAt: string;
  stableKey: string;
};

const TIMELINE_KINDS: readonly TimelineKind[] = [
  'customer_created',
  'contact_created',
  'site_created',
  'request_received',
  'request_event',
  'request_closed',
  'request_converted',
  'job_created',
  'project_created',
  'document_linked',
  'follow_up_event',
  'communication_preference_event',
];

function isTimelineKind(value: string): value is TimelineKind {
  return TIMELINE_KINDS.some((kind) => kind === value);
}

const TIMELINE_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isTimelineCursorSafe(cursor: Pick<TimelineCursor, 'occurredAt' | 'stableKey'>): boolean {
  const separatorIndex = cursor.stableKey.indexOf(':');
  if (separatorIndex <= 0) return false;
  const kind = cursor.stableKey.slice(0, separatorIndex);
  const sourceId = cursor.stableKey.slice(separatorIndex + 1);
  return (
    isTimelineKind(kind) &&
    isUuid(sourceId) &&
    TIMELINE_TIMESTAMP_PATTERN.test(cursor.occurredAt) &&
    Number.isFinite(Date.parse(cursor.occurredAt))
  );
}

export function timelineItemKey(kind: TimelineKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export function compareTimelineItems(
  left: Pick<TimelineItem, 'occurredAt' | 'stableKey'>,
  right: Pick<TimelineItem, 'occurredAt' | 'stableKey'>,
): number {
  const timeOrder = right.occurredAt.localeCompare(left.occurredAt);
  if (timeOrder !== 0) return timeOrder;
  return right.stableKey.localeCompare(left.stableKey);
}

function encodeTimelineCursor(item: Pick<TimelineItem, 'occurredAt' | 'stableKey'>): string {
  const cursor: TimelineCursor = {
    version: 1,
    occurredAt: item.occurredAt,
    stableKey: item.stableKey,
  };
  if (!isTimelineCursorSafe(cursor)) {
    throw new Error('Cannot encode an invalid timeline cursor.');
  }
  return btoa(JSON.stringify(cursor)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeTimelineCursor(value?: string | null): TimelineCursor | null {
  if (!value) return null;
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const parsed: unknown = JSON.parse(atob(padded));
    if (!isJsonRecord(parsed)) return null;
    const { version, occurredAt, stableKey } = parsed;
    if (version !== 1 || typeof occurredAt !== 'string' || typeof stableKey !== 'string') {
      return null;
    }
    const cursor: TimelineCursor = { version, occurredAt, stableKey };
    return isTimelineCursorSafe(cursor) ? cursor : null;
  } catch {
    return null;
  }
}

function isTimelineItemAfterCursor(
  item: Pick<TimelineItem, 'occurredAt' | 'stableKey'>,
  cursor: TimelineCursor,
): boolean {
  if (item.occurredAt < cursor.occurredAt) return true;
  if (item.occurredAt > cursor.occurredAt) return false;
  return item.stableKey < cursor.stableKey;
}

export function buildTimelinePage(
  candidates: TimelineItem[],
  cursorValue: string | null | undefined,
  pageSize: number,
): TimelinePage {
  const cursor = decodeTimelineCursor(cursorValue);
  const unique = new Map<string, TimelineItem>();
  for (const item of candidates) {
    const current = unique.get(item.stableKey);
    if (!current || compareTimelineItems(item, current) < 0) {
      unique.set(item.stableKey, item);
    }
  }

  const ordered = [...unique.values()]
    .filter((item) => !cursor || isTimelineItemAfterCursor(item, cursor))
    .sort(compareTimelineItems);
  const items = ordered.slice(0, pageSize);
  const lastItem = items.at(-1);
  return {
    items,
    nextCursor: ordered.length > pageSize && lastItem ? encodeTimelineCursor(lastItem) : null,
  };
}

export function isFollowUpOverdue(dueAt: string, status: string, now: Date = new Date()): boolean {
  return status === 'open' && Date.parse(dueAt) < now.getTime();
}

export function resolveCommunicationGuidance(input: {
  contactId: string | null;
  channel: CommunicationChannel;
  purpose: CommunicationPurpose;
  settings: CommunicationSettings | null;
  preferences: CommunicationPreference[];
}): CommunicationGuidance {
  const warnings: CommunicationGuidance['warnings'] = [];
  if (input.settings?.doNotContactInstruction) warnings.push('do_not_contact');
  if (input.settings?.preferredContactId && input.contactId !== input.settings.preferredContactId) {
    warnings.push('wrong_contact');
  }

  const contactRule =
    input.contactId === null
      ? undefined
      : input.preferences.find(
          (rule) =>
            rule.contactId === input.contactId &&
            rule.channel === input.channel &&
            rule.purpose === input.purpose,
        );
  const customerRule = input.preferences.find(
    (rule) => rule.contactId === null && rule.channel === input.channel && rule.purpose === input.purpose,
  );
  const resolved = contactRule ?? customerRule ?? null;
  if (resolved?.state === 'disallowed') warnings.push('disallowed_channel');

  return {
    state: resolved?.state ?? 'unknown',
    source: contactRule ? 'contact' : customerRule ? 'customer' : 'unconfigured',
    warnings: [...new Set(warnings)],
  };
}
