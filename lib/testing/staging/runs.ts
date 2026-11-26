// A staging journey's run: its id, the DEV actor and organization it creates, which of them a cleanup
// may remove, and what the kit may print (.claude/skills/staging-journey/SKILL.md). DEV also serves the
// partner preview, so a cleanup selects only rows that carry a run's marks (Tier 1).

/** `20261126-1530-a1b2c3`: UTC start minute and six random hex digits. */
const RUN_ID = /^20\d{6}-\d{4}-[0-9a-f]{6}$/;
const ORGANIZATION_PREFIX = 'Agenten-Test ';
/** A reserved test domain (RFC 2606): no mail to it leaves the internet's edge. */
const ACTOR_DOMAIN = 'werkflow-agents.test';
/** How long a run's rows stay before any machine's cleanup removes them. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function newRunId(now: Date, randomHex: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, '');
  const runId = `${stamp.slice(0, 8)}-${stamp.slice(9, 13)}-${randomHex.toLowerCase().slice(0, 6)}`;
  if (!RUN_ID.test(runId)) throw new Error('A run id needs six random hex digits.');
  return runId;
}

export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

export function runOrganizationName(runId: string): string {
  return `${ORGANIZATION_PREFIX}${runId}`;
}

export function runActorEmail(runId: string): string {
  return `agent+${runId}@${ACTOR_DOMAIN}`;
}

/** The SQL `like` pattern of every run's organization name and actor address. */
export const RUN_PATTERNS = {
  organizationName: `${ORGANIZATION_PREFIX}%`,
  actorEmail: `agent+%@${ACTOR_DOMAIN}`,
} as const;

function runIdOf(value: string, prefix: string, suffix: string): string | null {
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return null;
  const runId = value.slice(prefix.length, value.length - suffix.length);
  return RUN_ID.test(runId) ? runId : null;
}

export type ActorRow = { id: string; email: string; createdAt: string };
export type OrganizationRow = { id: string; name: string; adminId: string };

/** One run's rows a cleanup removes: its actor, and the organizations that actor administers. */
export type RunRows = { runId: string; actorId: string; organizationIds: string[] };

/**
 * The runs a cleanup removes: `runId`'s own, or with `null` every run whose actor was created more than
 * a day before `now`. An organization counts only when its name carries the same run id as its admin's
 * address; any other organization, even one named like a run's, is never selected.
 */
export function selectRuns(
  actors: readonly ActorRow[],
  organizations: readonly OrganizationRow[],
  runId: string | null,
  now: Date,
): RunRows[] {
  return actors.flatMap((actor) => {
    const actorRun = runIdOf(actor.email, 'agent+', `@${ACTOR_DOMAIN}`);
    if (actorRun === null) return [];
    const created = Date.parse(actor.createdAt);
    const selected =
      runId === null
        ? Number.isFinite(created) && now.getTime() - created > STALE_AFTER_MS
        : actorRun === runId;
    if (!selected) return [];
    const organizationIds = organizations
      .filter((row) => row.adminId === actor.id && runIdOf(row.name, ORGANIZATION_PREFIX, '') === actorRun)
      .map((row) => row.id);
    return [{ runId: actorRun, actorId: actor.id, organizationIds }];
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

export type Fact = string | number | boolean | null;

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
      throw new Error(
        `The fact ${name} of ${step} looks like an address or a key; print ids and states only.`,
      );
    return `${name}=${String(value)}`;
  });
  return `[staging] ${step}${parts.length ? `: ${parts.join(' ')}` : ''}`;
}
