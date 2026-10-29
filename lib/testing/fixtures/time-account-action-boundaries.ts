// Actual time-account form actions over the in-memory database: rules,
// account openings, period reopening and the payroll mapping are Admin-only,
// adjustments need Admin or Büro, the period and decision actions need a
// manager or a time-approval holder, and an Admin of organization A reaches
// no employee, account, request, finding, period or export of organization B.
// A decision is refused before its function call for the caller's own
// proposal and outside the caller's approval scope (a Büro member deciding for
// another Büro member). Every other write is one function call in the caller's
// organization, so the function's org-scoped lookup refuses the foreign id and
// nothing changes. Only the proposer withdraws an open request. A period
// preparation takes its source fingerprint before it reads a source.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertCallerScopedCalls, databaseSnapshot } from './workforce-boundary-support';

const ownRecordId = '84000000-0000-4000-8000-000000000001';
const foreignRecordId = '84000000-0000-4000-8000-000000000002';
const policyId = '84000000-0000-4000-8000-000000000003';
const foreignAccountId = '84000000-0000-4000-8000-000000000004';
const foreignRequestId = '84000000-0000-4000-8000-000000000005';
const foreignFindingId = '84000000-0000-4000-8000-000000000006';
const foreignPeriodId = '84000000-0000-4000-8000-000000000007';
const foreignExportId = '84000000-0000-4000-8000-000000000008';
const foreignDocumentId = '84000000-0000-4000-8000-000000000009';
const callerRecordId = '84000000-0000-4000-8000-000000000010';
const colleagueUserId = '84000000-0000-4000-8000-000000000011';
const colleagueRecordId = '84000000-0000-4000-8000-000000000012';
const ownProposalId = '84000000-0000-4000-8000-000000000013';
const colleagueRequestId = '84000000-0000-4000-8000-000000000014';
const decidableRequestId = '84000000-0000-4000-8000-000000000015';
const colleagueFindingId = '84000000-0000-4000-8000-000000000016';
const decidableFindingId = '84000000-0000-4000-8000-000000000017';
const holderConfigurationId = '84000000-0000-4000-8000-000000000020';

const noAccessRows = { personnel_access_lifecycles: [], personnel_onboarding_requirements: [] };
const world = installActionWorld({
  // The responsibility read embeds each record's access lifecycle and open access blockers.
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: null, ...noAccessRows },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null, ...noAccessRows },
    {
      id: callerRecordId,
      organization_id: ORGANIZATION_A,
      user_id: CALLER_ID,
      exit_date: null,
      ...noAccessRows,
    },
    {
      id: colleagueRecordId,
      organization_id: ORGANIZATION_A,
      user_id: colleagueUserId,
      exit_date: null,
      ...noAccessRows,
    },
  ],
  // No time-approval configuration: Admin and Büro hold the responsibility by role.
  organization_members: [
    { organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'employee' },
    { organization_id: ORGANIZATION_A, user_id: colleagueUserId, role: 'buero' },
  ],
  time_accounts: [
    { id: foreignAccountId, organization_id: ORGANIZATION_B, employee_record_id: foreignRecordId },
  ],
  time_account_adjustment_requests: [
    { id: foreignRequestId, organization_id: ORGANIZATION_B, status: 'pending' },
    // The record without a login counts as an employee; the colleague is Büro.
    {
      id: ownProposalId,
      organization_id: ORGANIZATION_A,
      employee_record_id: ownRecordId,
      requested_by: CALLER_ID,
    },
    {
      id: colleagueRequestId,
      organization_id: ORGANIZATION_A,
      employee_record_id: colleagueRecordId,
      requested_by: '84000000-0000-4000-8000-000000000018',
    },
    {
      id: decidableRequestId,
      organization_id: ORGANIZATION_A,
      employee_record_id: ownRecordId,
      requested_by: colleagueUserId,
    },
  ],
  time_period_findings: [
    { id: foreignFindingId, organization_id: ORGANIZATION_B, period_id: foreignPeriodId },
    { id: colleagueFindingId, organization_id: ORGANIZATION_A, employee_record_id: colleagueRecordId },
    { id: decidableFindingId, organization_id: ORGANIZATION_A, employee_record_id: ownRecordId },
  ],
  time_periods: [
    {
      id: foreignPeriodId,
      organization_id: ORGANIZATION_B,
      period_end_date: '2026-09-30',
      current_calculation_id: '84000000-0000-4000-8000-00000000000a',
      current_close_version_id: '84000000-0000-4000-8000-00000000000b',
    },
  ],
  payroll_exports: [
    { id: foreignExportId, organization_id: ORGANIZATION_B, state: 'ready', document_id: foreignDocumentId },
  ],
  documents: [
    {
      id: foreignDocumentId,
      organization_id: ORGANIZATION_B,
      storage_path: `${ORGANIZATION_B}/${foreignDocumentId}/lohn.csv`,
      original_file_name: 'lohn.csv',
    },
  ],
});
// The account functions load their target inside the organization they are
// given (supabase/tests/p1_23_*.sql); a policy assignment of a foreign
// employee fails the composite foreign key of its insert.
const foreignKeyViolation = { code: '23503', message: 'violates foreign key constraint' };
const targets: Readonly<Record<string, readonly [string, string, string | typeof foreignKeyViolation]>> = {
  assign_time_account_policy: ['employee_records', 'p_employee_record_id', foreignKeyViolation],
  open_time_account: ['employee_records', 'p_employee_record_id', 'employee_not_found'],
  submit_time_account_adjustment: ['time_accounts', 'p_account_id', 'account_not_found'],
  decide_time_account_adjustment: ['time_account_adjustment_requests', 'p_request_id', 'request_not_found'],
  withdraw_time_account_adjustment: ['time_account_adjustment_requests', 'p_request_id', 'request_not_found'],
  decide_time_period_finding: ['time_period_findings', 'p_finding_id', 'finding_not_found'],
  close_time_period: ['time_periods', 'p_period_id', 'period_not_found'],
  reopen_time_period: ['time_periods', 'p_period_id', 'period_not_found'],
};
world.rpc = ({ name, args }) => {
  const target = targets[name];
  if (!target) return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
  const [table, idArgument, refusal] = target;
  const found = tableRows(world, table).some(
    (row) => row.id === args[idArgument] && row.organization_id === args.p_organization_id,
  );
  if (found) return { data: '84000000-0000-4000-8000-0000000000ff', error: null };
  return { data: null, error: typeof refusal === 'string' ? { code: 'P0001', message: refusal } : refusal };
};
const signedPaths: string[] = [];
const outsideFixture = (name: string) => (): never => {
  throw new Error(`${name} is outside this fixture`);
};
mock.module('@/lib/storage/r2', () => ({
  createSignedDownloadUrl: async ({ path }: { path: string }) => {
    signedPaths.push(path);
    return `https://storage.example.test/${path}`;
  },
  discardStorageObjects: outsideFixture('discardStorageObjects'),
  putStorageObject: outsideFixture('putStorageObject'),
}));
const {
  assignEmployeeTimePolicy,
  closeTimePeriod,
  createDefaultPayrollMapping,
  createStarterTimePolicy,
  downloadPayrollExport,
  generatePayrollExport,
  getTimeAccountAccess,
  openMissingTimeAccounts,
  prepareTimePeriod,
  reopenTimePeriod,
  submitTimeAccountAdjustment,
} = await import('@/lib/time-accounts/actions');
const { decidePeriodFinding, decideTimeAccountAdjustment, withdrawTimeAccountAdjustment } = await import(
  '@/lib/time-accounts/decision-actions'
);

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const forms = {
  policy: () => form({ effectiveFrom: '2026-11-01', name: 'Standard-Arbeitszeit' }),
  assign: (employeeRecordId: string) =>
    form({ employeeRecordId, policyId, validFrom: '2026-11-01', reason: 'Teilzeitregel' }),
  open: (employeeRecordId: string) =>
    form({ employeeRecordId, openingMinutes: '0', openedOn: '2026-11-01', reason: 'Einführung' }),
  adjust: (accountId: string) =>
    form({
      accountId,
      expectedVersion: '1',
      adjustmentKind: 'manual_adjustment',
      minutes: '60',
      effectiveDate: '2026-11-01',
      reason: 'Nachtrag',
    }),
  decide: (requestId: string) =>
    form({ requestId, expectedVersion: '1', decision: 'approved', reason: 'Passt' }),
  withdraw: (requestId: string) => form({ requestId, expectedVersion: '1' }),
  prepare: () => form({ month: '2026-10' }),
  finding: (findingId: string) => form({ findingId, periodId: foreignPeriodId, decision: 'acknowledged' }),
  period: (periodId: string) => form({ periodId }),
  reopen: (periodId: string) => form({ periodId, reason: 'Korrektur erforderlich' }),
  download: (exportId: string) => form({ exportId }),
};
const forbidden = { success: false, error: 'forbidden' };
// The responsibility state reads the caller's role from the organization's members.
const callerMembership = tableRows(world, 'organization_members').find((row) => row.user_id === CALLER_ID);
const signInWithRole = (role: 'admin' | 'buero' | 'employee'): void => {
  signInAs(world, role);
  if (callerMembership) callerMembership.role = role;
};
const initialDatabase = databaseSnapshot(world);

// A signed-out caller is sent to the login before any database access.
world.callerId = null;
await assert.rejects(getTimeAccountAccess(), /redirect:\/login/);
await assert.rejects(closeTimePeriod(forms.period(foreignPeriodId)), /redirect:\/login/);
assert.equal(world.adminClientRequests, 0);

// An employee without a time-approval responsibility manages nothing.
signInWithRole('employee');
assert.deepEqual(await getTimeAccountAccess(), {
  success: true,
  canManage: false,
  managementReadFailed: false,
  isAdmin: false,
  canProposeAdjustments: false,
  canExportPayroll: false,
});
assert.deepEqual(await submitTimeAccountAdjustment(forms.adjust(foreignAccountId)), forbidden);
assert.deepEqual(await decideTimeAccountAdjustment(forms.decide(foreignRequestId)), forbidden);
assert.deepEqual(await withdrawTimeAccountAdjustment(forms.withdraw(ownProposalId)), forbidden);
assert.deepEqual(await prepareTimePeriod(forms.prepare()), forbidden);
assert.deepEqual(await decidePeriodFinding(forms.finding(foreignFindingId)), forbidden);
assert.deepEqual(await closeTimePeriod(forms.period(foreignPeriodId)), forbidden);
assert.deepEqual(await generatePayrollExport(forms.period(foreignPeriodId)), forbidden);
assert.deepEqual(await downloadPayrollExport(forms.download(foreignExportId)), forbidden);

// An employee named as the time-approval holder manages periods, but the
// payroll export stays Admin and Büro work: the page hides the export card,
// and both export actions refuse before any read or signed URL.
world.tables.organization_responsibility_configurations = [
  {
    id: holderConfigurationId,
    organization_id: ORGANIZATION_A,
    responsibility: 'time_approval',
    mode: 'selected',
    effective_from: '2026-01-01T00:00:00.000Z',
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];
world.tables.organization_responsibility_assignments = [
  {
    id: '84000000-0000-4000-8000-000000000021',
    organization_id: ORGANIZATION_A,
    configuration_id: holderConfigurationId,
    employee_record_id: callerRecordId,
    source: 'direct',
    role_snapshot: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
];
assert.deepEqual(await getTimeAccountAccess(), {
  success: true,
  canManage: true,
  managementReadFailed: false,
  isAdmin: false,
  canProposeAdjustments: false,
  canExportPayroll: false,
});
const requestsBeforeExport = world.adminClientRequests;
assert.deepEqual(await generatePayrollExport(forms.period(foreignPeriodId)), forbidden);
assert.deepEqual(await downloadPayrollExport(forms.download(foreignExportId)), forbidden);
assert.equal(
  world.adminClientRequests,
  requestsBeforeExport,
  'a holder reached the database through an export action',
);
assert.deepEqual(signedPaths, [], 'a holder received a signed export URL');
delete world.tables.organization_responsibility_configurations;
delete world.tables.organization_responsibility_assignments;

// Büro changes no rule, opens no account, reopens no period and maps no payroll codes.
signInWithRole('buero');
assert.deepEqual(await createStarterTimePolicy(forms.policy()), forbidden);
assert.deepEqual(await assignEmployeeTimePolicy(forms.assign(ownRecordId)), forbidden);
assert.deepEqual(await openMissingTimeAccounts(forms.open(ownRecordId)), forbidden);
assert.deepEqual(await reopenTimePeriod(forms.reopen(foreignPeriodId)), forbidden);
assert.deepEqual(await createDefaultPayrollMapping(), forbidden);
assert.equal(world.rpcCalls.length, 0);

// Büro decides neither its own proposal nor a matter of another Büro member.
assert.deepEqual(await decideTimeAccountAdjustment(forms.decide(ownProposalId)), {
  success: false,
  error: 'own_proposal',
});
assert.deepEqual(await decideTimeAccountAdjustment(forms.decide(colleagueRequestId)), {
  success: false,
  error: 'not_responsible_or_self_approval',
});
assert.deepEqual(await decidePeriodFinding(forms.finding(colleagueFindingId)), forbidden);
assert.equal(world.rpcCalls.length, 0, 'a decision outside the approval scope reached the database');
// A colleague's proposal for a person without a login is Büro's to decide.
assert.deepEqual(await decideTimeAccountAdjustment(forms.decide(decidableRequestId)), { success: true });
assert.deepEqual(await decidePeriodFinding(forms.finding(decidableFindingId)), { success: true });
assert.equal(world.rpcCalls.length, 2);
assertCallerScopedCalls(world);

// Only the proposer withdraws: a colleague's request is refused before the call, the own one reaches it once.
world.rpcCalls.length = 0;
assert.deepEqual(await withdrawTimeAccountAdjustment(forms.withdraw(decidableRequestId)), {
  success: false,
  error: 'not_proposer',
});
assert.equal(world.rpcCalls.length, 0, 'a withdrawal by another person reached the database');
assert.deepEqual(await withdrawTimeAccountAdjustment(forms.withdraw(ownProposalId)), { success: true });
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_actor_id]),
  [['withdraw_time_account_adjustment', CALLER_ID]],
);
assertCallerScopedCalls(world);

// An Admin of organization A reaches no row of organization B: each write is refused by its one call.
signInWithRole('admin');
for (const [write, expected] of [
  [() => assignEmployeeTimePolicy(forms.assign(foreignRecordId)), 'assignment_failed'],
  [() => openMissingTimeAccounts(forms.open(foreignRecordId)), 'employee_not_found'],
  [() => submitTimeAccountAdjustment(forms.adjust(foreignAccountId)), 'account_not_found'],
  [() => closeTimePeriod(forms.period(foreignPeriodId)), 'period_not_found'],
  [() => reopenTimePeriod(forms.reopen(foreignPeriodId)), 'period_not_found'],
] as const) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await write(), { success: false, error: expected });
  assert.equal(world.rpcCalls.length, 1, `${expected}: a refused write made a second call`);
  assertCallerScopedCalls(world);
}

// A decision or withdrawal loads its request or finding in the caller's organization first, so a foreign id never reaches the database.
world.rpcCalls.length = 0;
assert.deepEqual(await decideTimeAccountAdjustment(forms.decide(foreignRequestId)), {
  success: false,
  error: 'request_not_found',
});
assert.deepEqual(await decidePeriodFinding(forms.finding(foreignFindingId)), {
  success: false,
  error: 'finding_not_found',
});
assert.deepEqual(await withdrawTimeAccountAdjustment(forms.withdraw(foreignRequestId)), {
  success: false,
  error: 'request_not_found',
});

// A foreign period is not a closed period of the caller's organization, and a foreign export is not ready.

assert.deepEqual(await generatePayrollExport(forms.period(foreignPeriodId)), {
  success: false,
  error: 'period_not_closed',
});
assert.deepEqual(await downloadPayrollExport(forms.download(foreignExportId)), {
  success: false,
  error: 'export_not_ready',
});
assert.equal(world.rpcCalls.length, 0);
assert.deepEqual(signedPaths, [], 'no foreign export may be signed');

// The preparation takes its source fingerprint before it reads a source, so a
// correction filed during the reads changes the fingerprint and
// prepare_time_period refuses it instead of storing findings without it.
const seededTables = world.tables;
const readTables: string[] = [];
world.tables = new Proxy(seededTables, {
  get: (tables, table, receiver) => {
    if (typeof table === 'string') readTables.push(table);
    return Reflect.get(tables, table, receiver);
  },
});
const boundaryRpc = world.rpc;
const sourceReadsBeforeFingerprint: string[][] = [];
world.rpc = (call) => {
  if (call.name !== 'get_time_period_source_fingerprint') return boundaryRpc(call);
  sourceReadsBeforeFingerprint.push(readTables.filter((table) => table.startsWith('time_')));
  return { data: null, error: { code: 'P0001', message: 'fingerprint_probe' } };
};
assert.deepEqual(await prepareTimePeriod(forms.prepare()), { success: false, error: 'prepare_failed' });
assert.deepEqual(
  sourceReadsBeforeFingerprint,
  [[]],
  'the preparation read a period source before its source fingerprint, or took none',
);
assertCallerScopedCalls(world);
world.tables = seededTables;
world.rpc = boundaryRpc;
if (callerMembership) callerMembership.role = 'employee';
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
