// A staging journey's run: its id, the DEV actor and organization it creates, which of them a cleanup
// may remove, and what the kit may print (.claude/skills/staging-journey/SKILL.md). DEV also serves the
// partner preview, so a cleanup selects only rows that carry a run's marks (Tier 1).

import type { OrganizationRetentionRefusal } from '../../org/types';

/** `20261126-1530-a1b2c3`: UTC start minute and six random hex digits. */
const RUN_ID = /^20\d{6}-\d{4}-[0-9a-f]{6}$/;
const ORGANIZATION_PREFIX = 'Agenten-Test ';
/** A reserved test domain (RFC 2606) for every actor that receives no mail: none leaves the internet's edge. */
const ACTOR_DOMAIN = 'werkflow-agents.test';
/**
 * Resend's simulated delivery address, which accepts a label after `+`: an invited member's mail goes
 * through the shared Resend account, reaches no person and never bounces.
 */
const MEMBER_DOMAIN = 'resend.dev';
/** How long a run's rows stay before any machine's cleanup removes them. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function newRunId(now: Date, randomHex: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, '');
  const runId = `${stamp.slice(0, 8)}-${stamp.slice(9, 13)}-${randomHex.toLowerCase().slice(0, 6)}`;
  if (!RUN_ID.test(runId)) throw new StagingFailure('A run id needs six random hex digits.');
  return runId;
}

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

export function runOrganizationName(runId: string): string {
  return `${ORGANIZATION_PREFIX}${runId}`;
}

/** The roles a run's member actors join its organization with (`org_role`, an Admin cannot be invited). */
export const MEMBER_ROLES = ['buero', 'employee'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export function isMemberRole(role: string): role is MemberRole {
  return MEMBER_ROLES.some((known) => known === role);
}

/** Where a run address holds its run id. */
const RUN_SLOT = '{run}';
/** The address of a run's actor that receives no mail, such as an Admin. */
const ACTOR_ADDRESS = `agent+${RUN_SLOT}@${ACTOR_DOMAIN}`;
/**
 * The address a run's member is invited at and signs in with: Resend's simulated delivery address,
 * labeled with the role and the run, so each run and role has its own.
 */
const memberAddress = (role: MemberRole) => `delivered+agent-${role}-${RUN_SLOT}@${MEMBER_DOMAIN}`;
/** Every address a run's actor can have, with `{run}` for the run id. */
const RUN_ADDRESSES = [ACTOR_ADDRESS, ...MEMBER_ROLES.map(memberAddress)];

function filled(address: string, runId: string): string {
  if (!RUN_ID.test(runId)) throw new StagingFailure('A run address needs a run id.');
  return address.replace(RUN_SLOT, runId);
}

export function runActorEmail(runId: string): string {
  return filled(ACTOR_ADDRESS, runId);
}

export function runMemberEmail(runId: string, role: MemberRole): string {
  return filled(memberAddress(role), runId);
}

/** The SQL `like` pattern of every run's organization name. */
export const RUN_ORGANIZATION_PATTERN = `${ORGANIZATION_PREFIX}%`;

/**
 * The read of every run's actor on DEV: a user only when its address is a run address filled with its
 * own run marker, which only the secret key writes. No other user's id or address leaves the database.
 */
export function runActorsQuery(): { query: string; parameters: string[] } {
  const addresses = RUN_ADDRESSES.map((_, index) => `replace($${index + 1}, '${RUN_SLOT}', run.marker)`);
  return {
    query: `select id, email, created_at, run.marker as run_marker, run.retired as retired_marker from auth.users cross join lateral (select raw_app_meta_data->>'werkflow_agent_run' as marker, raw_app_meta_data->>'${RETIRED_MARKER}' as retired) run where run.marker ~ '^20[0-9]{6}-[0-9]{4}-[0-9a-f]{6}$' and email in (${addresses.join(', ')})`,
    parameters: [...RUN_ADDRESSES],
  };
}

/** The run an actor's address names, as a run's Admin or as one of its members, or null for any other address. */
export function actorRunId(email: string): string | null {
  for (const address of RUN_ADDRESSES) {
    const [prefix = '', suffix = ''] = address.split(RUN_SLOT);
    if (!email.startsWith(prefix) || !email.endsWith(suffix)) continue;
    const runId = email.slice(prefix.length, email.length - suffix.length);
    if (RUN_ID.test(runId)) return runId;
  }
  return null;
}

/**
 * `runMarker`: the run id in the user's app metadata, which only the secret key writes.
 * `retiredMarker`: the reason a cleanup retired the run, in the same metadata, or null.
 */
export type ActorRow = {
  id: string;
  email: string;
  createdAt: string;
  runMarker: string | null;
  retiredMarker: string | null;
};
export type OrganizationRow = { id: string; name: string; adminId: string };

/**
 * One run's rows a cleanup removes: its actor, and the organizations that actor administers. A retired
 * run (`retired`, its reason) stays on DEV, and no cleanup touches it again.
 */
export type RunRows = {
  runId: string;
  actorId: string;
  organizationIds: string[];
  retired: RetireReason | 'unknown' | null;
};

// --- Retirement: a run the app keeps ---

/** The app metadata key that marks a retired run's actor; nothing removes it. */
export const RETIRED_MARKER = 'werkflow_agent_retired';

/**
 * The one refusal that retires a run instead of failing its cleanup: the app keeps an organization that
 * holds recorded working time (`lib/org/deletion-scope.ts`), and recorded time is never erased.
 */
const RETIRE_REASON = 'has_time_records' satisfies OrganizationRetentionRefusal;
export type RetireReason = typeof RETIRE_REASON;

/** The refusal codes the organization's deletion dialog names in `data-retention-refusals`. */
export function retentionRefusals(attribute: string | null): string[] {
  return (attribute ?? '').split(' ').filter(Boolean);
}

/**
 * The reason to retire a run, when the app's refusals are exactly the one for recorded working time.
 * Any other refusal, alone or beside it, is none: that cleanup fails.
 */
export function retireReason(refusals: readonly string[]): RetireReason | null {
  return refusals.length === 1 && refusals[0] === RETIRE_REASON ? RETIRE_REASON : null;
}

/**
 * The reason a retired marker names, `unknown` for any other value it holds, or null when the actor
 * carries none: any marker keeps the run retired.
 */
export function retiredAs(marker: unknown): RetireReason | 'unknown' | null {
  if (marker === null || marker === undefined) return null;
  return marker === RETIRE_REASON ? RETIRE_REASON : 'unknown';
}

/**
 * What a cleanup does with its selected runs: it skips each retired one and cleans the rest, an Admin's
 * run first, since its organization's deletion ends its members' memberships, which their account
 * deletion waits for.
 */
export function sweepPlan(runs: readonly RunRows[]): { clean: RunRows[]; retired: RunRows[] } {
  return {
    clean: runs
      .filter((run) => run.retired === null)
      .sort((first, second) => second.organizationIds.length - first.organizationIds.length),
    retired: runs.filter((run) => run.retired !== null),
  };
}

/**
 * The runs a cleanup removes: `runId`'s own, or with `null` every run whose actor was created more than
 * a day before `now`. An actor counts only when its address and its run marker name the same run. An organization counts only when its name carries the same run id as its admin's
 * address; any other organization, even one named like a run's, is never selected.
 */
export function selectRuns(
  actors: readonly ActorRow[],
  organizations: readonly OrganizationRow[],
  runId: string | null,
  now: Date,
): RunRows[] {
  return actors.flatMap((actor) => {
    const actorRun = actorRunId(actor.email);
    // The address alone proves nothing: the marker only the kit's secret key writes must match it.
    if (actorRun === null || actor.runMarker !== actorRun) return [];
    const created = Date.parse(actor.createdAt);
    const selected =
      runId === null
        ? Number.isFinite(created) && now.getTime() - created > STALE_AFTER_MS
        : actorRun === runId;
    if (!selected) return [];
    const organizationIds = organizations
      .filter((row) => row.adminId === actor.id && row.name === runOrganizationName(actorRun))
      .map((row) => row.id);
    return [{ runId: actorRun, actorId: actor.id, organizationIds, retired: retiredAs(actor.retiredMarker) }];
  });
}

const SECRET_SHAPES =
  /\b(?:sbp|sb_secret|sb_publishable|rk_test|rk_live|sk_test|sk_live|whsec|eyJ)[A-Za-z0-9_.-]*/g;

/** A failure's printed line stays this short: the step's own words, not a provider's page. */
const FAILURE_LINE_LENGTH = 240;

/**
 * Text a journey prints, with every value it holds as a secret (keys, the actor's password), every
 * key-shaped or mail-shaped word and every URL query or fragment replaced, cut to one short line.
 * A failure's message passes here before it reaches the log.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let safe = text.split('\n')[0] ?? '';
  for (const secret of secrets) if (secret) safe = safe.split(secret).join('[redacted]');
  safe = safe
    .replace(/(https?:\/\/[^\s"'<>()?#]+)[?#][^\s"'<>()]*/g, '$1?[redacted]')
    .replace(SECRET_SHAPES, '[redacted]')
    .replace(/[^\s"'<>()]+@[^\s"'<>()]+/g, '[address]');
  return safe.length > FAILURE_LINE_LENGTH ? `${safe.slice(0, FAILURE_LINE_LENGTH - 1)}…` : safe;
}

/** A failure the kit or a journey raises with its own words, which may be printed after `redact`. */
export class StagingFailure extends Error {
  override name = 'StagingFailure';
}

/** Playwright's action or assertion that failed, such as `locator.click` or `expect(page).toHaveURL`. */
const BROWSER_ACTION =
  /^(?:[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)?(?=:)|expect\((?:page|locator)\)\.(?:not\.)?[a-z][A-Za-z]*)/;

/**
 * A failure as one printable line. The kit's own failures keep their redacted words. Any other error,
 * a browser's or a provider's, is named only by its kind and the browser action that raised it: its
 * text can quote a URL, a page or a response body.
 */
export function failureText(error: unknown, secrets: readonly string[]): string {
  if (error instanceof StagingFailure) return redact(error.message, secrets);
  if (!(error instanceof Error)) return 'unknown failure';
  const action = BROWSER_ACTION.exec(error.message.replace(/^Error: /, ''))?.[0];
  const kind = /^[A-Za-z]+$/.test(error.name) ? error.name : 'Error';
  return action ? `${action} failed (${kind})` : `${kind}`;
}

export type Fact = string | number | boolean | null;

/**
 * Refused origins as one printable fact, redacted and cut like a failure line, so a long or key-shaped
 * host never makes `factLine` throw after a journey that passed.
 */
export function originsFact(origins: Iterable<string>, secrets: readonly string[]): string {
  return redact([...origins].join(','), secrets);
}

/**
 * One printed line: a step and its ids and states. A value that holds a secret, or looks like an
 * address, a key or a URL with a query, throws.
 */
export function factLine(
  step: string,
  facts: Readonly<Record<string, Fact>> = {},
  secrets: readonly string[] = [],
): string {
  const parts = Object.entries(facts).map(([name, value]) => {
    if (typeof value === 'string' && redact(value, secrets) !== value)
      throw new StagingFailure(
        `The fact ${name} of ${step} looks like an address or a key; print ids and states only.`,
      );
    return `${name}=${String(value)}`;
  });
  return `[staging] ${step}${parts.length ? `: ${parts.join(' ')}` : ''}`;
}
