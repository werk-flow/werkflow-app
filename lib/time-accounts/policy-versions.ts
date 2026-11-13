import { addLocalDays } from '@/lib/date-time/berlin';

/** The fields of a policy version that decide when it applies. */
type DatedVersion = { effective_from: string; version: number };

const latestFirst = (left: DatedVersion, right: DatedVersion): number =>
  left.effective_from === right.effective_from
    ? right.version - left.version
    : right.effective_from.localeCompare(left.effective_from);

/**
 * The version of one policy in force on a date: the latest start on or
 * before it, and of two versions with the same start the later version. The
 * period calculation and the rules card both read it, so the card marks the
 * version the calculation uses.
 */
export function versionInForce<Version extends DatedVersion>(
  versions: readonly Version[],
  date: string,
): Version | undefined {
  return [...versions].sort(latestFirst).find((version) => version.effective_from <= date);
}

type PolicyVersionStatus = 'in_force' | 'planned' | 'past' | 'replaced';

export type PolicyVersionLine = {
  version: number;
  effectiveFrom: string;
  /** The last day it applies: the day before the next later start; null while no later start exists. */
  validUntil: string | null;
  status: PolicyVersionStatus;
  /** A version with the same start and a higher number replaced it before it ever applied. */
  replacedBy: number | null;
};

/** Every version of one policy, latest start first, with the span it applies on and its state today. */
export function describePolicyVersions(
  versions: readonly DatedVersion[],
  today: string,
): PolicyVersionLine[] {
  const ordered = [...versions].sort(latestFirst);
  const current = versionInForce(ordered, today);
  return ordered.map((version) => {
    // Latest first, so the first match is the highest version with this start.
    const sameStart = ordered.find(
      (other) => other.effective_from === version.effective_from && other.version > version.version,
    );
    const nextStart = ordered
      .filter((other) => other.effective_from > version.effective_from)
      .at(-1)?.effective_from;
    const status: PolicyVersionStatus = sameStart
      ? 'replaced'
      : version === current
        ? 'in_force'
        : version.effective_from > today
          ? 'planned'
          : 'past';
    return {
      version: version.version,
      effectiveFrom: version.effective_from,
      validUntil: sameStart || !nextStart ? null : addLocalDays(nextStart, -1),
      status,
      replacedBy: sameStart?.version ?? null,
    };
  });
}
