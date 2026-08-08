import { describe, expect, test } from 'bun:test';
import {
  getCertificationAttentionVersion,
  resolveApprenticeWarning,
  resolveAssignmentEvaluation,
  resolveCertificationExpiryPhase,
  resolveRequirementCoverage,
} from './resolution';
import type {
  AssignmentCandidate,
  EmployeeCapabilityRecord,
  JobCapabilityRequirement,
} from './types';

const requirement: JobCapabilityRequirement = {
  id: 'requirement-1',
  capabilityId: 'capability-1',
  capabilityName: 'Herstellertraining A',
  capabilityKind: 'certification',
  requireConfirmation: true,
};

function record(
  patch: Partial<EmployeeCapabilityRecord> = {}
): EmployeeCapabilityRecord {
  return {
    id: 'record-1',
    employeeRecordId: 'employee-record-1',
    capabilityId: 'capability-1',
    capabilityKind: 'certification',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    issuer: null,
    renewalDueDate: null,
    confirmationStatus: 'confirmed',
    evidenceState: 'not_required',
    operationalNote: null,
    supersedesId: null,
    supersededAt: null,
    ...patch,
  };
}

function candidate(
  patch: Partial<AssignmentCandidate> = {}
): AssignmentCandidate {
  return {
    userId: 'user-1',
    employeeRecordId: 'employee-record-1',
    displayName: 'Anna Beispiel',
    employmentType: 'vollzeit',
    capabilityRecords: [record()],
    ...patch,
  };
}

describe('qualification coverage resolution', () => {
  test('treats validity boundaries as inclusive', () => {
    expect(
      resolveRequirementCoverage(requirement, [candidate()], '2026-01-01').status
    ).toBe('covered');
    expect(
      resolveRequirementCoverage(requirement, [candidate()], '2026-12-31').status
    ).toBe('covered');
  });

  test('uses the strongest overlapping certification without losing attribution', () => {
    const person = candidate({
      capabilityRecords: [
        record({
          id: 'expired',
          validUntil: '2025-12-31',
          confirmationStatus: 'confirmed',
        }),
        record({
          id: 'current-unconfirmed',
          confirmationStatus: 'unconfirmed',
        }),
      ],
    });

    const result = resolveRequirementCoverage(
      requirement,
      [person],
      '2026-06-01'
    );
    expect(result.status).toBe('unconfirmed');
    expect(result.contributor?.employeeCapabilityId).toBe(
      'current-unconfirmed'
    );
  });

  test('separates team coverage from the named contributor', () => {
    const expired = candidate({
      userId: 'user-expired',
      displayName: 'Erik Alt',
      capabilityRecords: [record({ id: 'expired', validUntil: '2025-12-31' })],
    });
    const covered = candidate({
      userId: 'user-covered',
      employeeRecordId: 'employee-record-2',
      displayName: 'Clara Neu',
      capabilityRecords: [record({ id: 'covered' })],
    });

    const result = resolveRequirementCoverage(
      requirement,
      [expired, covered],
      '2026-06-01'
    );
    expect(result.status).toBe('covered');
    expect(result.contributor?.displayName).toBe('Clara Neu');
  });

  test('does not count unconfirmed certification when confirmation is required', () => {
    const result = resolveRequirementCoverage(
      requirement,
      [
        candidate({
          capabilityRecords: [
            record({ confirmationStatus: 'unconfirmed' }),
          ],
        }),
      ],
      '2026-06-01'
    );
    expect(result.status).toBe('unconfirmed');
  });

  test('reports future records separately from missing coverage', () => {
    const result = resolveRequirementCoverage(
      requirement,
      [candidate({ capabilityRecords: [record({ validFrom: '2027-01-01' })] })],
      '2026-06-01'
    );

    expect(result.status).toBe('not_yet_valid');
  });

  test('ignores superseded records', () => {
    const result = resolveRequirementCoverage(
      requirement,
      [
        candidate({
          capabilityRecords: [record({ supersededAt: '2026-05-01T10:00:00Z' })],
        }),
      ],
      '2026-06-01'
    );

    expect(result.status).toBe('missing');
  });

  test('shows missing coverage without requiring an override for an unassigned job', () => {
    const result = resolveAssignmentEvaluation({
      jobId: 'job-1',
      assessedForDate: '2026-06-01',
      candidates: [],
      requirements: [requirement],
      apprenticeWarningEnabled: true,
    });

    expect(result.requirementCoverage[0].status).toBe('missing');
    expect(result.requiresOverride).toBe(false);
  });

  test('requires an override when a selected person leaves a requirement uncovered', () => {
    const result = resolveAssignmentEvaluation({
      jobId: 'job-1',
      assessedForDate: '2026-06-01',
      candidates: [candidate({ capabilityRecords: [] })],
      requirements: [requirement],
      apprenticeWarningEnabled: false,
    });

    expect(result.requirementCoverage[0].status).toBe('missing');
    expect(result.requiresOverride).toBe(true);
  });
});

describe('apprentice assignment signal', () => {
  test('is default-off and clears when a known non-apprentice is selected', () => {
    const apprentice = candidate({ employmentType: 'ausbildung' });
    expect(resolveApprenticeWarning(false, [apprentice]).status).toBe(
      'not_configured'
    );
    expect(
      resolveApprenticeWarning(true, [
        apprentice,
        candidate({ userId: 'user-2', employmentType: 'vollzeit' }),
      ]).status
    ).toBe('covered');
  });

  test('distinguishes apprentice-only from unknown employment conditions', () => {
    expect(
      resolveApprenticeWarning(true, [
        candidate({ employmentType: 'ausbildung' }),
      ]).status
    ).toBe('apprentices_only');
    expect(
      resolveApprenticeWarning(true, [
        candidate({ employmentType: null }),
      ]).status
    ).toBe('incomplete');
  });
});

describe('evaluation fingerprints and expiry attention', () => {
  test('changes the fingerprint when a coverage fact changes', () => {
    const before = resolveAssignmentEvaluation({
      jobId: 'job-1',
      assessedForDate: '2026-06-01',
      candidates: [candidate()],
      requirements: [requirement],
      apprenticeWarningEnabled: false,
    });
    const after = resolveAssignmentEvaluation({
      jobId: 'job-1',
      assessedForDate: '2026-06-01',
      candidates: [
        candidate({
          capabilityRecords: [
            record({ confirmationStatus: 'unconfirmed' }),
          ],
        }),
      ],
      requirements: [requirement],
      apprenticeWarningEnabled: false,
    });
    expect(before.fingerprint).not.toBe(after.fingerprint);
  });

  test('re-surfaces on validity phase changes but evidence is absent from the version', () => {
    expect(
      resolveCertificationExpiryPhase('2026-08-31', '2026-08-08', 30)
    ).toBe('approaching');
    expect(
      resolveCertificationExpiryPhase('2026-08-07', '2026-08-08', 30)
    ).toBe('expired');
    expect(
      resolveCertificationExpiryPhase('2026-08-07', '2026-08-08', 0)
    ).toBe('expired');
    expect(
      resolveCertificationExpiryPhase('2026-08-31', '2026-08-08', Number.NaN)
    ).toBe('none');
    expect(
      getCertificationAttentionVersion({
        validUntil: '2026-08-31',
        phase: 'approaching',
      })
    ).toBe('2026-08-31:approaching');
  });
});
