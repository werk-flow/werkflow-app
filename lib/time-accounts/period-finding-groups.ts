import { TIME_ACTIVITY_LABELS } from '@/lib/time-tracking/types';
import { z } from '@/lib/zod';
import { FINDING_LABELS, type TimeFindingKind } from './presentation';
import type { TimePeriodDetail } from './queries';

// The period page's Prüfhinweise, one group per kind with the people it
// affects, and where and by whom each kind is fixed
// (werk-flow/werkflow-planning#48): twelve people without a Zeitkonto are one
// blocker with twelve names, not twelve loose rows.

type PeriodFinding = TimePeriodDetail['findings'][number];

export type PeriodFindingGroup = {
  kind: TimeFindingKind;
  severity: string;
  /** Sorted by name, then by id, so the order stays across preparations. */
  findings: PeriodFinding[];
};

const SEVERITY_ORDER = ['close_blocked', 'approval_required'];
const KIND_ORDER = Object.keys(FINDING_LABELS);

function severityRank(severity: string): number {
  const rank = SEVERITY_ORDER.indexOf(severity);
  return rank === -1 ? SEVERITY_ORDER.length : rank;
}

/** Blocking groups first, then approvals, then information; each in the label order. */
export function groupPeriodFindings(findings: readonly PeriodFinding[]): PeriodFindingGroup[] {
  const groups = new Map<string, PeriodFindingGroup>();
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.kind}`;
    const group = groups.get(key) ?? { kind: finding.kind, severity: finding.severity, findings: [] };
    group.findings.push(finding);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      findings: [...group.findings].sort(
        (left, right) =>
          (left.employeeName ?? '').localeCompare(right.employeeName ?? '', 'de') ||
          left.id.localeCompare(right.id),
      ),
    }))
    .sort(
      (left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind),
    );
}

/** Who can fix a kind: an Admin, Admin and Büro, or whoever manages the period. */
type FindingFixer = 'admin' | 'office' | 'manager';

export type PeriodFindingFix = {
  /** What fixes it, as a to-do that reads right for the fixer and for whoever asks them. */
  instruction: string;
  fixedBy: FindingFixer;
  /** One screen for the whole group, or each person's own page. */
  target: { href: string; label: string } | 'person';
};

const TIME_ACCOUNT_RULES = { href: '/zeiterfassung/einstellungen', label: 'Zu den Zeitkonto-Regeln' };
const TIME_HISTORY = { href: '/zeiterfassung?tab=history', label: 'Zum Verlauf' };

/** The fix of each kind the period page can point to; a kind decided here or only informing has none. */
export const PERIOD_FINDING_FIXES: Partial<Record<TimeFindingKind, PeriodFindingFix>> = {
  missing_policy: {
    instruction: 'Arbeitszeitregel anlegen oder zuweisen, gültig ab dem Monatsanfang.',
    fixedBy: 'admin',
    target: TIME_ACCOUNT_RULES,
  },
  missing_opening_balance: {
    instruction: 'Zeitkonto mit Saldo und Eröffnungsdatum eröffnen.',
    fixedBy: 'admin',
    target: TIME_ACCOUNT_RULES,
  },
  missing_schedule: {
    instruction: 'Wochenplan im Arbeitszeitmodell der Person hinterlegen.',
    fixedBy: 'office',
    target: 'person',
  },
  missing_clock: {
    instruction: 'Fehlende Buchung im Verlauf ergänzen.',
    fixedBy: 'manager',
    target: TIME_HISTORY,
  },
  overlap: {
    instruction: 'Überlappende Zeiten im Verlauf korrigieren.',
    fixedBy: 'manager',
    target: TIME_HISTORY,
  },
  pending_correction: {
    instruction: 'Offene Zeitkorrektur entscheiden.',
    fixedBy: 'manager',
    target: { href: '/zeiterfassung?tab=approvals', label: 'Zu den Freigaben' },
  },
  stale_calculation: {
    instruction: 'Monat neu vorbereiten.',
    fixedBy: 'manager',
    target: { href: '/zeiterfassung/perioden', label: 'Zu den Perioden' },
  },
};

/** The page of one person, where the Wochenplan lives. */
export function personFixHref(employeeRecordId: string): string {
  return `/mitarbeiter/${employeeRecordId}`;
}

/** The roles the viewer holds that matter for a fix. */
export type FindingViewer = { isAdmin: boolean; isOffice: boolean };

/** Whether the viewer can fix the kind; the period page itself requires a manager. */
export function canFixFinding(fix: PeriodFindingFix, viewer: FindingViewer): boolean {
  if (fix.fixedBy === 'admin') return viewer.isAdmin;
  if (fix.fixedBy === 'office') return viewer.isAdmin || viewer.isOffice;
  return true;
}

/** Who to ask when the viewer cannot fix the kind. */
export const FINDING_FIXER_LABELS: Readonly<Record<Exclude<FindingFixer, 'manager'>, string>> = {
  admin: 'Nur Admin',
  office: 'Nur Admin und Büro',
};

const unallocatedTimeExplanationSchema = z.object({
  minutes: z.number(),
  entries: z.array(
    z.object({
      date: z.string(),
      startedAt: z.string(),
      endedAt: z.string(),
      activityKind: z.string(),
      minutes: z.number(),
    }),
  ),
});

export type UnallocatedTimeExplanation = z.infer<typeof unallocatedTimeExplanationSchema>;

/**
 * The entries of a „Zeit ohne Zuordnung“ finding; null for a calculation
 * prepared before the entries were stored.
 */
export function readUnallocatedTime(explanation: Record<string, unknown>): UnallocatedTimeExplanation | null {
  const parsed = unallocatedTimeExplanationSchema.safeParse(explanation);
  return parsed.success ? parsed.data : null;
}

/** „Arbeit“ for a stored activity kind, neutral German for an unknown one. */
export function activityLabel(activityKind: string): string {
  return Object.entries(TIME_ACTIVITY_LABELS).find(([kind]) => kind === activityKind)?.[1] ?? 'Zeit';
}

const datesExplanationSchema = z.object({ dates: z.array(z.string()).min(1) });

/** The days a finding names (absence conflicts and warnings), or null. */
export function readFindingDates(explanation: Record<string, unknown>): string[] | null {
  const parsed = datesExplanationSchema.safeParse(explanation);
  return parsed.success ? parsed.data.dates : null;
}
