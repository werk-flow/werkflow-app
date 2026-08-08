import { createHash } from 'node:crypto';

import type {
  ApprenticeWarning,
  AssignmentCandidate,
  AssignmentEvaluation,
  CoverageStatus,
  EmployeeCapabilityRecord,
  JobCapabilityRequirement,
  RequirementCoverage,
} from './types';

const COVERAGE_RANK: Record<CoverageStatus, number> = {
  covered: 0,
  unconfirmed: 1,
  expired: 2,
  not_yet_valid: 3,
  missing: 4,
};

function compareRecordAttribution(
  left: EmployeeCapabilityRecord,
  right: EmployeeCapabilityRecord,
  status: CoverageStatus
): number {
  if (status === 'not_yet_valid') {
    return left.validFrom.localeCompare(right.validFrom) || left.id.localeCompare(right.id);
  }
  if (status === 'expired') {
    return (
      (right.validUntil ?? '').localeCompare(left.validUntil ?? '') ||
      left.id.localeCompare(right.id)
    );
  }
  return (
    right.validFrom.localeCompare(left.validFrom) || left.id.localeCompare(right.id)
  );
}

function statusForRecord(
  record: EmployeeCapabilityRecord,
  requirement: JobCapabilityRequirement,
  assessedForDate: string
): CoverageStatus {
  if (record.validFrom > assessedForDate) return 'not_yet_valid';
  if (record.validUntil && record.validUntil < assessedForDate) return 'expired';
  if (
    requirement.capabilityKind === 'certification' &&
    requirement.requireConfirmation &&
    record.confirmationStatus !== 'confirmed'
  ) {
    return 'unconfirmed';
  }
  return 'covered';
}

function strongestCandidateRecord(
  candidate: AssignmentCandidate,
  requirement: JobCapabilityRequirement,
  assessedForDate: string
): { status: CoverageStatus; record: EmployeeCapabilityRecord | null } {
  let strongest: { status: CoverageStatus; record: EmployeeCapabilityRecord } | null =
    null;

  for (const record of candidate.capabilityRecords) {
    if (
      record.capabilityId !== requirement.capabilityId ||
      record.supersededAt !== null
    ) {
      continue;
    }
    const status = statusForRecord(record, requirement, assessedForDate);
    if (
      !strongest ||
      COVERAGE_RANK[status] < COVERAGE_RANK[strongest.status] ||
      (status === strongest.status &&
        compareRecordAttribution(record, strongest.record, status) < 0)
    ) {
      strongest = { status, record };
    }
  }

  return strongest ?? { status: 'missing', record: null };
}

export function resolveRequirementCoverage(
  requirement: JobCapabilityRequirement,
  candidates: AssignmentCandidate[],
  assessedForDate: string
): RequirementCoverage {
  let strongest:
    | {
        status: CoverageStatus;
        candidate: AssignmentCandidate;
        record: EmployeeCapabilityRecord;
      }
    | null = null;

  for (const candidate of [...candidates].sort((left, right) =>
    left.userId.localeCompare(right.userId)
  )) {
    const result = strongestCandidateRecord(
      candidate,
      requirement,
      assessedForDate
    );
    if (!result.record) continue;
    if (
      !strongest ||
      COVERAGE_RANK[result.status] < COVERAGE_RANK[strongest.status] ||
      (result.status === strongest.status &&
        compareRecordAttribution(result.record, strongest.record, result.status) < 0)
    ) {
      strongest = {
        status: result.status,
        candidate,
        record: result.record,
      };
    }
  }

  if (!strongest) {
    return { requirement, status: 'missing', contributor: null };
  }

  return {
    requirement,
    status: strongest.status,
    contributor: {
      userId: strongest.candidate.userId,
      employeeRecordId: strongest.candidate.employeeRecordId,
      displayName: strongest.candidate.displayName,
      employeeCapabilityId: strongest.record.id,
    },
  };
}

export function resolveApprenticeWarning(
  enabled: boolean,
  candidates: AssignmentCandidate[]
): ApprenticeWarning {
  if (!enabled || candidates.length === 0) {
    return { status: 'not_configured' };
  }

  const knownNonApprentice = candidates.some(
    (candidate) =>
      candidate.employmentType !== null &&
      candidate.employmentType !== 'ausbildung'
  );
  if (knownNonApprentice) return { status: 'covered' };

  const missingConditionNames = candidates
    .filter((candidate) => candidate.employmentType === null)
    .map((candidate) => candidate.displayName);
  if (missingConditionNames.length > 0) {
    return { status: 'incomplete', missingConditionNames };
  }

  return {
    status: 'apprentices_only',
    apprenticeNames: candidates.map((candidate) => candidate.displayName),
  };
}

function hashFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function buildAssignmentFingerprint(input: {
  assessedForDate: string;
  candidates: AssignmentCandidate[];
  requirements: JobCapabilityRequirement[];
  apprenticeWarningEnabled: boolean;
}): string {
  const stableValue = JSON.stringify({
    assessedForDate: input.assessedForDate,
    apprenticeWarningEnabled: input.apprenticeWarningEnabled,
    candidates: [...input.candidates]
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .map((candidate) => ({
        userId: candidate.userId,
        employeeRecordId: candidate.employeeRecordId,
        employmentType: candidate.employmentType,
        capabilityRecords: [...candidate.capabilityRecords]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((record) => ({
            id: record.id,
            capabilityId: record.capabilityId,
            capabilityKind: record.capabilityKind,
            validFrom: record.validFrom,
            validUntil: record.validUntil,
            confirmationStatus: record.confirmationStatus,
            supersededAt: record.supersededAt,
          })),
      })),
    requirements: [...input.requirements]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((requirement) => ({
        id: requirement.id,
        capabilityId: requirement.capabilityId,
        capabilityKind: requirement.capabilityKind,
        requireConfirmation: requirement.requireConfirmation,
      })),
  });
  return `p1-09:${hashFingerprint(stableValue)}`;
}

export function resolveAssignmentEvaluation(input: {
  jobId: string | null;
  assessedForDate: string;
  candidates: AssignmentCandidate[];
  requirements: JobCapabilityRequirement[];
  apprenticeWarningEnabled: boolean;
}): AssignmentEvaluation {
  const requirementCoverage = input.requirements.map((requirement) =>
    resolveRequirementCoverage(
      requirement,
      input.candidates,
      input.assessedForDate
    )
  );
  const apprenticeWarning = resolveApprenticeWarning(
    input.apprenticeWarningEnabled,
    input.candidates
  );

  return {
    jobId: input.jobId,
    assessedForDate: input.assessedForDate,
    selectedUserIds: input.candidates.map((candidate) => candidate.userId),
    selectedEmployeeRecordIds: input.candidates.map(
      (candidate) => candidate.employeeRecordId
    ),
    requirementCoverage,
    apprenticeWarning,
    requiresOverride:
      input.candidates.length > 0 &&
      (requirementCoverage.some((coverage) => coverage.status !== 'covered') ||
        apprenticeWarning.status === 'apprentices_only' ||
        apprenticeWarning.status === 'incomplete'),
    fingerprint: buildAssignmentFingerprint(input),
  };
}

export type CertificationExpiryPhase = 'none' | 'approaching' | 'expired';

export function resolveCertificationExpiryPhase(
  validUntil: string | null,
  today: string,
  warningDays: number
): CertificationExpiryPhase {
  if (!validUntil) return 'none';
  if (validUntil < today) return 'expired';
  if (!Number.isFinite(warningDays) || warningDays <= 0) return 'none';

  const todayDate = new Date(`${today}T00:00:00Z`);
  const warningDate = new Date(todayDate);
  warningDate.setUTCDate(warningDate.getUTCDate() + warningDays);
  const warningThrough = warningDate.toISOString().slice(0, 10);
  return validUntil <= warningThrough ? 'approaching' : 'none';
}

export function getCertificationAttentionVersion(input: {
  validUntil: string;
  phase: Exclude<CertificationExpiryPhase, 'none'>;
}): string {
  return `${input.validUntil}:${input.phase}`;
}
