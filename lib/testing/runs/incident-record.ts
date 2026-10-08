import type { IncidentClass } from '../runner/run-policy';

/**
 * The incident-log entry of a classified browser group failure. `bun run test:runs classify`
 * writes it, so the durable record exists as soon as the cause is known (docs/technical/testing.md,
 * "Failures"). The agent adds the evidence, the correction and the focused proof under it later.
 */
export type IncidentRecord = {
  runKey: string;
  groupId: string;
  target: string;
  groupFingerprint: string | null;
  worldId: string | null;
  startedAt: string;
  classification: IncidentClass;
  firstFailure: { title: string; message: string } | null;
  rootCause: string;
  prevention: string;
};

/**
 * The tier rule of the incident log (decision 0005). `scripts/check-docs.ts` applies it to every
 * dated section, so an entry the command writes always passes the docs check.
 */
export const INCIDENT_TIER_PATTERN =
  /\bTier [12]\b|\bTier 3\b[^.\n]*(?::|\bbecause\b|\()|\bno (?:\w+ )*prevention claim\b/i;

/** Authoring and accepted-change are not failures of proven behavior, so they leave no incident. */
const UNRECORDED_CLASSES: readonly IncidentClass[] = ['authoring', 'accepted-change'];

/** A failed acceptance run (the group lane) gets an entry; focused and diagnostic runs do not. */
export function recordsIncident(
  run: { lane: string; groupId?: string | undefined },
  classification: IncidentClass,
): boolean {
  return run.lane === 'group' && Boolean(run.groupId) && !UNRECORDED_CLASSES.includes(classification);
}

export function incidentPreventionProblem(prevention: string): string | null {
  if (INCIDENT_TIER_PATTERN.test(prevention)) return null;
  return 'The prevention goes into the incident log and must name its enforcement tier: "Tier 1 ...", "Tier 2 ...", "Tier 3: <why no mechanism reaches it>", or "no prevention claim" (decision 0005).';
}

const MESSAGE_LIMIT = 240;
// Playwright messages carry ANSI colour codes; the escape sequences start with the ESC character.
const ANSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function firstLine(message: string): string {
  const line =
    message
      .replace(ANSI_SEQUENCE, '')
      .split('\n')
      .map((part) => part.trim())
      .find(Boolean) ?? '';
  return line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT - 1)}…` : line;
}

function markerOf(runKey: string): string {
  return `<!-- incident-run: ${runKey} -->`;
}

function incidentEntry(record: IncidentRecord): string {
  const run = [
    `run \`${record.runKey}\``,
    `group \`${record.groupId}\``,
    `target ${record.target}`,
    record.groupFingerprint ? `fingerprint \`${record.groupFingerprint.slice(0, 12)}\`` : null,
    record.worldId ? `world \`${record.worldId}\`` : null,
  ].filter((part): part is string => part !== null);
  const failure = record.firstFailure
    ? `${record.firstFailure.title}: ${firstLine(record.firstFailure.message)}`
    : 'no failed test recorded; read the run log.';
  return [
    `## ${record.startedAt.slice(0, 10)}: ${record.groupId} ${record.classification} failure`,
    '',
    markerOf(record.runKey),
    '',
    `- Run: ${run.join(', ')}.`,
    `- Failure point: ${failure}`,
    `- Root cause: ${record.rootCause.trim()}`,
    `- Prevention: ${record.prevention.trim()}`,
    '',
  ].join('\n');
}

/**
 * Insert the entry before the newest dated section, or replace the entry of the same run when it is
 * classified again, so the log stays newest first and holds one entry per run.
 */
export function withIncidentEntry(log: string, record: IncidentRecord): string {
  const entry = `${incidentEntry(record)}\n`;
  const sections = log.split(/^(?=## )/m);
  const existing = sections.findIndex((section) => section.includes(markerOf(record.runKey)));
  if (existing >= 0) {
    sections[existing] = entry;
    return sections.join('');
  }
  const firstDated = sections.findIndex((section) => /^## \d{4}-\d{2}-\d{2}/.test(section));
  if (firstDated < 0) return `${log.trimEnd()}\n\n${entry}`;
  sections.splice(firstDated, 0, entry);
  return sections.join('');
}
