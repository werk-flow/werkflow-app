// Isolated stand-in for `@/lib/qualifications/actions`: the team and
// qualification tabs read this workspace as route props, and creating a team
// or confirming an entry waits in the write gate until the spec answers it.
import type { QualificationWorkspace } from '@/lib/qualifications/types';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

declare global {
  interface Window {
    uiContractQualifications: Pick<
      QualificationWorkspace,
      'teams' | 'teamMemberships' | 'capabilities' | 'employeeCapabilities' | 'employees'
    >;
  }
}

window.uiContractQualifications = {
  teams: [],
  teamMemberships: [],
  capabilities: [
    {
      id: 'contract-capability',
      organizationId: 'contract-organization',
      kind: 'certification',
      name: 'Gasschein',
      description: null,
      defaultExpiryWarningDays: 30,
      retiredAt: null,
    },
  ],
  employeeCapabilities: [
    {
      id: 'contract-capability-record',
      employeeRecordId: 'contract-worker-record',
      capabilityId: 'contract-capability',
      capabilityKind: 'certification',
      validFrom: '2026-01-01',
      validUntil: null,
      issuer: null,
      renewalDueDate: null,
      confirmationStatus: 'unconfirmed',
      evidenceState: 'not_required',
      operationalNote: null,
      supersedesId: null,
      supersededAt: null,
    },
  ],
  employees: [
    { employeeRecordId: 'contract-worker-record', userId: 'contract-worker', displayName: 'Tim Tanner' },
  ],
};

export async function createTeam(input: {
  name: string;
  description?: string | null;
}): Promise<{ success: true; teamId: string } | { success: false; error: string }> {
  const refusal = await holdWrite('create-team', input);
  if (refusal) return { success: false, error: refusal };
  const teamId = `contract-team-${window.uiContractQualifications.teams.length + 1}`;
  window.uiContractQualifications.teams = [
    ...window.uiContractQualifications.teams,
    {
      id: teamId,
      organizationId: 'contract-organization',
      name: input.name.trim(),
      description: input.description?.trim() || null,
      dissolvedAt: null,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    },
  ];
  return { success: true, teamId };
}

export async function updateEmployeeCapability(input: {
  recordId: string;
  confirmationStatus: 'confirmed' | 'unconfirmed';
}): Promise<{ success: true } | { success: false; error: string }> {
  const refusal = await holdWrite('update-employee-capability', input);
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractQualifications;
  state.employeeCapabilities = state.employeeCapabilities.map((record) =>
    record.id === input.recordId ? { ...record, confirmationStatus: input.confirmationStatus } : record,
  );
  return { success: true };
}

export const updateTeam = unexpectedWrite;
export const dissolveTeam = unexpectedWrite;
export const addTeamMembership = unexpectedWrite;
export const endTeamMembership = unexpectedWrite;
export const createCapability = unexpectedWrite;
export const retireCapabilityDefinition = unexpectedWrite;
export const addEmployeeCapability = unexpectedWrite;
export const setApprenticeWarningEnabled = unexpectedWrite;
