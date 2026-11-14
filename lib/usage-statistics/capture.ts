import 'server-only';

import { after } from 'next/server';
import { logError } from '@/lib/logging';
import { isUuid } from '@/lib/validation/uuid';

// The one way WerkFlow sends anonymous usage statistics to PostHog
// (docs/technical/security.md#usage-statistics). Only WerkFlow's server sends,
// after a workflow step succeeded. An event names a workflow and a step and is
// keyed by the organization alone: no person, role, record id, content or IP.
// Without a project key, or for an organization missing from the allowlist,
// nothing leaves the server.

export type UsageWorkflow =
  | 'work_report'
  | 'time_recording'
  | 'follow_up'
  | 'request'
  | 'handover'
  | 'maintenance_visit'
  | 'blocker';

export type UsageStep = 'started' | 'completed' | 'abandoned';

// PostHog's EU ingestion host; the project lives in the EU cloud.
const CAPTURE_URL = 'https://eu.i.posthog.com/i/v0/e/';
const SEND_TIMEOUT_MS = 5_000;

/** Every property an event may carry. The guard below refuses any other key before sending. */
const ALLOWED_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  'workflow',
  'step',
  '$process_person_profile',
  '$geoip_disable',
]);

type UsageEventProperties = {
  workflow: UsageWorkflow;
  step: UsageStep;
  $process_person_profile: false;
  $geoip_disable: true;
};

type UsageEventPayload = {
  api_key: string;
  event: `${UsageWorkflow}_${UsageStep}`;
  distinct_id: string;
  properties: UsageEventProperties;
};

/** The organizations whose signed AVV allows usage statistics, from `POSTHOG_ORGANIZATION_IDS`. */
function allowedOrganizationIds(): ReadonlySet<string> {
  const entries = (process.env.POSTHOG_ORGANIZATION_IDS ?? '').split(',').map((entry) => entry.trim());
  return new Set(entries.filter(isUuid).map((entry) => entry.toLowerCase()));
}

/**
 * True when every property key is allowed; a new property must join the list and its review.
 * @internal exported for the guard's test.
 */
export function carriesOnlyAllowedProperties(properties: object): boolean {
  return Object.keys(properties).every((key) => ALLOWED_PROPERTY_KEYS.has(key));
}

/** The event this step sends, or null when nothing may leave: no key, or the organization is not allowed. */
function usageEventFor(
  organizationId: string,
  workflow: UsageWorkflow,
  step: UsageStep,
): UsageEventPayload | null {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim();
  if (!apiKey) return null;
  if (!allowedOrganizationIds().has(organizationId.toLowerCase())) return null;
  return {
    api_key: apiKey,
    event: `${workflow}_${step}`,
    distinct_id: organizationId,
    properties: { workflow, step, $process_person_profile: false, $geoip_disable: true },
  };
}

async function send(payload: UsageEventPayload): Promise<void> {
  try {
    const response = await fetch(CAPTURE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // Only the status is logged: PostHog's answer may quote the request.
    if (!response.ok) logError('captureUsage: PostHog refused the event', { status: response.status });
  } catch (error) {
    // best-effort: the workflow step already succeeded; a lost count only thins the statistics.
    logError('captureUsage: PostHog unreachable', error);
  }
}

/**
 * Counts one succeeded workflow step for the caller's organization, after the
 * response. Takes the organization from a resolved action context only. A
 * failed send is logged and never fails the step.
 */
export function captureUsage(organizationId: string, workflow: UsageWorkflow, step: UsageStep): void {
  const payload = usageEventFor(organizationId, workflow, step);
  if (!payload) return;
  if (!carriesOnlyAllowedProperties(payload.properties)) {
    logError('captureUsage: event carries a property outside the allowlist');
    return;
  }
  after(() => send(payload));
}
