export const CAPABILITY_KINDS = ['skill', 'certification'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

export const CONFIRMATION_STATUSES = ['unconfirmed', 'confirmed'] as const;
export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const EVIDENCE_STATES = ['not_required', 'pending', 'received'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export const COVERAGE_STATUSES = [
  'covered',
  'unconfirmed',
  'expired',
  'not_yet_valid',
  'missing',
] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export type CapabilityDefinition = {
  id: string;
  organizationId: string;
  kind: CapabilityKind;
  name: string;
  description: string | null;
  defaultExpiryWarningDays: number;
  retiredAt: string | null;
};

export type EmployeeCapabilityRecord = {
  id: string;
  employeeRecordId: string;
  capabilityId: string;
  capabilityKind: CapabilityKind;
  validFrom: string;
  validUntil: string | null;
  issuer: string | null;
  renewalDueDate: string | null;
  confirmationStatus: ConfirmationStatus;
  evidenceState: EvidenceState;
  operationalNote: string | null;
  supersedesId: string | null;
  supersededAt: string | null;
};

export type AssignmentCandidate = {
  userId: string;
  employeeRecordId: string;
  displayName: string;
  employmentType: string | null;
  capabilityRecords: EmployeeCapabilityRecord[];
};

export type JobCapabilityRequirement = {
  id: string;
  capabilityId: string;
  capabilityName: string;
  capabilityKind: CapabilityKind;
  requireConfirmation: boolean;
};

export type CoverageContributor = {
  userId: string;
  employeeRecordId: string;
  displayName: string;
  employeeCapabilityId: string;
};

export type RequirementCoverage = {
  requirement: JobCapabilityRequirement;
  status: CoverageStatus;
  contributor: CoverageContributor | null;
};

export type ApprenticeWarning =
  | { status: 'not_configured' | 'covered' }
  | { status: 'apprentices_only'; apprenticeNames: string[] }
  | { status: 'incomplete'; missingConditionNames: string[] };

export type AssignmentEvaluation = {
  jobId: string | null;
  assessedForDate: string;
  selectedUserIds: string[];
  selectedEmployeeRecordIds: string[];
  requirementCoverage: RequirementCoverage[];
  apprenticeWarning: ApprenticeWarning;
  requiresOverride: boolean;
  fingerprint: string;
};

export type AssignmentApproval = {
  fingerprint: string;
  reason: string;
  teamSourceId?: string | null;
};

export type Team = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  dissolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeamMembership = {
  id: string;
  organizationId: string;
  teamId: string;
  employeeRecordId: string;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QualificationEmployee = {
  employeeRecordId: string;
  userId: string | null;
  displayName: string;
};

export type QualificationWorkspace = {
  teams: Team[];
  teamMemberships: TeamMembership[];
  capabilities: CapabilityDefinition[];
  employeeCapabilities: EmployeeCapabilityRecord[];
  employees: QualificationEmployee[];
  apprenticeWarningEnabled: boolean;
  isAdmin: boolean;
};

export type OwnQualificationProfile = {
  employee: QualificationEmployee;
  teamNames: string[];
  capabilities: Array<{
    definition: CapabilityDefinition;
    record: EmployeeCapabilityRecord;
  }>;
};

export type JobQualificationDetail = {
  capabilities: CapabilityDefinition[];
  requirements: JobCapabilityRequirement[];
  evaluation: AssignmentEvaluation;
  latestAssessment: {
    createdAt: string;
    overrideReason: string | null;
    coverageFingerprint: string;
  } | null;
};

export const QUALIFICATION_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du darfst diese Qualifikationsdaten nicht bearbeiten.',
  invalid_input: 'Bitte prüfe die eingegebenen Angaben.',
  definition_not_found: 'Die Qualifikation wurde nicht gefunden.',
  employee_not_found: 'Der Mitarbeiter wurde nicht gefunden.',
  job_not_found: 'Der Auftrag wurde nicht gefunden.',
  duplicate_name: 'Eine Qualifikation mit diesem Namen ist bereits vorhanden.',
  overlap: 'Dieser Zeitraum überschneidet sich mit einem bestehenden Eintrag.',
  stale_evaluation:
    'Die Qualifikationsdaten haben sich geändert. Bitte prüfe den aktualisierten Hinweis.',
  qualification_warning:
    'Die hinterlegten Anforderungen sind noch nicht vollständig abgedeckt.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

export function getCoverageStatusLabel(status: CoverageStatus): string {
  switch (status) {
    case 'covered':
      return 'Abgedeckt';
    case 'unconfirmed':
      return 'Wirksam, intern noch nicht bestätigt';
    case 'expired':
      return 'Abgelaufen';
    case 'not_yet_valid':
      return 'Noch nicht gültig';
    case 'missing':
      return 'Nicht hinterlegt';
  }
}

export function getCapabilityKindLabel(kind: CapabilityKind): string {
  return kind === 'skill' ? 'Fähigkeit' : 'Zertifizierung';
}
