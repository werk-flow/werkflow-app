// Actual time-account form actions over the in-memory database: rules,
// account openings, period reopening and the payroll mapping are Admin-only,
// adjustments need Admin or Büro, the period and decision actions need a
// manager or a time-approval holder, and an Admin of organization A reaches
// no employee, account, request, finding, period or export of organization B.
// Every write is one function call in the caller's organization, so the
// function's org-scoped lookup refuses the foreign id and nothing changes.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
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

const world = installActionWorld({
  employee_records: [
    { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: null },
    { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null },
  ],
  time_accounts: [
    { id: foreignAccountId, organization_id: ORGANIZATION_B, employee_record_id: foreignRecordId },
  ],
  time_account_adjustment_requests: [
    { id: foreignRequestId, organization_id: ORGANIZATION_B, status: 'pending' },
  ],
  time_period_findings: [
    { id: foreignFindingId, organization_id: ORGANIZATION_B, period_id: foreignPeriodId },
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
  decidePeriodFinding,
  decideTimeAccountAdjustment,
  downloadPayrollExport,
  generatePayrollExport,
  getTimeAccountAccess,
  openMissingTimeAccounts,
  prepareTimePeriod,
  reopenTimePeriod,
  submitTimeAccountAdjustment,
} = await import('@/lib/time-accounts/actions');

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
  prepare: () => form({ month: '2026-10' }),
  finding: (findingId: string) => form({ findingId, periodId: foreignPeriodId, decision: 'acknowledged' }),
  period: (periodId: string) => form({ periodId }),
  reopen: (periodId: string) => form({ periodId, reason: 'Korrektur erforderlich' }),
  download: (exportId: string) => form({ exportId }),
};
const initialDatabase = databaseSnapshot(world);
const forbidden = { success: false, error: 'forbidden' };

// A signed-out caller is sent to the login before any database access.
world.callerId = null;
await assert.rejects(getTimeAccountAccess(), /redirect:\/login/);
await assert.rejects(closeTimePeriod(forms.period(foreignPeriodId)), /redirect:\/login/);
assert.equal(world.adminClientRequests, 0);

// An employee without a time-approval responsibility manages nothing.
signInAs(world, 'employee');
assert.deepEqual(await getTimeAccountAccess(), {
  success: true,
  canManage: false,
  managementReadFailed: false,
  isAdmin: false,
  canProposeAdjustments: false,
});
assert.deepEqual(await submitTimeAccountAdjustment(forms.adjust(foreignAccountId)), forbidden);
assert.deepEqual(await decideTimeAccountAdjustment(forms.decide(foreignRequestId)), forbidden);
assert.deepEqual(await prepareTimePeriod(forms.prepare()), forbidden);
assert.deepEqual(await decidePeriodFinding(forms.finding(foreignFindingId)), forbidden);
assert.deepEqual(await closeTimePeriod(forms.period(foreignPeriodId)), forbidden);
assert.deepEqual(await generatePayrollExport(forms.period(foreignPeriodId)), forbidden);
assert.deepEqual(await downloadPayrollExport(forms.download(foreignExportId)), forbidden);

// Büro changes no rule, opens no account, reopens no period and maps no payroll codes.
signInAs(world, 'buero');
assert.deepEqual(await createStarterTimePolicy(forms.policy()), forbidden);
assert.deepEqual(await assignEmployeeTimePolicy(forms.assign(ownRecordId)), forbidden);
assert.deepEqual(await openMissingTimeAccounts(forms.open(ownRecordId)), forbidden);
assert.deepEqual(await reopenTimePeriod(forms.reopen(foreignPeriodId)), forbidden);
assert.deepEqual(await createDefaultPayrollMapping(), forbidden);
assert.equal(world.rpcCalls.length, 0);

// An Admin of organization A reaches no row of organization B: each write is refused by its one call.
signInAs(world, 'admin');
for (const [write, expected] of [
  [() => assignEmployeeTimePolicy(forms.assign(foreignRecordId)), 'assignment_failed'],
  [() => openMissingTimeAccounts(forms.open(foreignRecordId)), 'employee_not_found'],
  [() => submitTimeAccountAdjustment(forms.adjust(foreignAccountId)), 'account_not_found'],
  [() => decideTimeAccountAdjustment(forms.decide(foreignRequestId)), 'request_not_found'],
  [() => decidePeriodFinding(forms.finding(foreignFindingId)), 'finding_not_found'],
  [() => closeTimePeriod(forms.period(foreignPeriodId)), 'period_not_found'],
  [() => reopenTimePeriod(forms.reopen(foreignPeriodId)), 'period_not_found'],
] as const) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await write(), { success: false, error: expected });
  assert.equal(world.rpcCalls.length, 1, `${expected}: a refused write made a second call`);
  assertCallerScopedCalls(world);
}

// A foreign period is not a closed period of the caller's organization, and a foreign export is not ready.
world.rpcCalls.length = 0;
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
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
