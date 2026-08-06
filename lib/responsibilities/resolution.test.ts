import { describe, expect, test } from 'bun:test';

import {
  canHolderApproveTarget,
  getResponsibilitiesStrandedByEmployeeRemoval,
  resolveEffectiveResponsibility,
  type ResponsibilityConfiguration,
  type ResponsibilityDelegation,
  type ResponsibilityMember,
} from './resolution';

const members: ResponsibilityMember[] = [
  {
    employeeRecordId: 'admin-record',
    userId: 'admin-user',
    role: 'admin',
    active: true,
  },
  {
    employeeRecordId: 'buero-record',
    userId: 'buero-user',
    role: 'buero',
    active: true,
  },
  {
    employeeRecordId: 'employee-record',
    userId: 'employee-user',
    role: 'employee',
    active: true,
  },
];

const directConfiguration: ResponsibilityConfiguration = {
  id: 'selected-version',
  responsibility: 'time_approval',
  mode: 'selected',
  effectiveFrom: '2026-08-05T08:00:00.000Z',
  createdAt: '2026-08-05T08:00:00.000Z',
  assignments: [
    {
      id: 'direct-assignment',
      configurationId: 'selected-version',
      employeeRecordId: 'buero-record',
      source: 'direct',
      roleSnapshot: null,
    },
  ],
};

function resolveWithDelegation(
  businessDate: string,
  delegation: ResponsibilityDelegation
) {
  return resolveEffectiveResponsibility({
    responsibility: 'time_approval',
    actionTime: '2026-08-10T10:00:00.000Z',
    businessDate,
    members,
    configurations: [directConfiguration],
    delegations: [delegation],
  });
}

describe('resolveEffectiveResponsibility', () => {
  test('uses fixed-role defaults when no configuration exists', () => {
    const result = resolveEffectiveResponsibility({
      responsibility: 'time_approval',
      actionTime: '2026-08-05T10:00:00.000Z',
      businessDate: '2026-08-05',
      members,
      configurations: [],
      delegations: [],
    });

    expect(result.configurationId).toBeNull();
    expect(result.mode).toBe('role_default');
    expect(result.holders.map((holder) => holder.userId)).toEqual([
      'admin-user',
      'buero-user',
    ]);
    expect(result.holders[0]?.source.kind).toBe('role_default');
  });

  test('selects the newest version effective at the action time', () => {
    const futureConfiguration: ResponsibilityConfiguration = {
      ...directConfiguration,
      id: 'future-version',
      effectiveFrom: '2026-08-06T08:00:00.000Z',
      createdAt: '2026-08-06T08:00:00.000Z',
      assignments: [
        {
          id: 'future-assignment',
          configurationId: 'future-version',
          employeeRecordId: 'employee-record',
          source: 'direct',
          roleSnapshot: null,
        },
      ],
    };

    const result = resolveEffectiveResponsibility({
      responsibility: 'time_approval',
      actionTime: '2026-08-05T10:00:00.000Z',
      businessDate: '2026-08-05',
      members,
      configurations: [directConfiguration, futureConfiguration],
      delegations: [],
    });

    expect(result.configurationId).toBe('selected-version');
    expect(result.holders[0]?.employeeRecordId).toBe('buero-record');
  });

  test.each([
    ['before', '2026-08-09', false],
    ['start', '2026-08-10', true],
    ['end', '2026-08-12', true],
    ['after', '2026-08-13', false],
  ])('resolves delegation on the %s boundary', (_, date, expected) => {
    const result = resolveWithDelegation(date, {
      id: 'delegation',
      responsibility: 'time_approval',
      delegatorEmployeeRecordId: 'buero-record',
      substituteEmployeeRecordId: 'employee-record',
      validFrom: '2026-08-10',
      validUntil: '2026-08-12',
      revokedFrom: null,
    });

    expect(
      result.holders.some(
        (holder) => holder.employeeRecordId === 'employee-record'
      )
    ).toBe(expected);
  });

  test('revocation is exclusive and preserves earlier days', () => {
    const delegation: ResponsibilityDelegation = {
      id: 'delegation',
      responsibility: 'time_approval',
      delegatorEmployeeRecordId: 'buero-record',
      substituteEmployeeRecordId: 'employee-record',
      validFrom: '2026-08-10',
      validUntil: '2026-08-15',
      revokedFrom: '2026-08-13',
    };

    expect(resolveWithDelegation('2026-08-12', delegation).holders).toHaveLength(
      2
    );
    expect(resolveWithDelegation('2026-08-13', delegation).holders).toHaveLength(
      1
    );
  });

  test('a delegate inherits the delegator target scope', () => {
    const roleDefaultConfiguration: ResponsibilityConfiguration = {
      ...directConfiguration,
      mode: 'role_default',
      assignments: [
        {
          id: 'buero-default',
          configurationId: 'selected-version',
          employeeRecordId: 'buero-record',
          source: 'role_default',
          roleSnapshot: 'buero',
        },
      ],
    };
    const result = resolveEffectiveResponsibility({
      responsibility: 'time_approval',
      actionTime: '2026-08-10T10:00:00.000Z',
      businessDate: '2026-08-10',
      members,
      configurations: [roleDefaultConfiguration],
      delegations: [
        {
          id: 'delegation',
          responsibility: 'time_approval',
          delegatorEmployeeRecordId: 'buero-record',
          substituteEmployeeRecordId: 'employee-record',
          validFrom: '2026-08-10',
          validUntil: '2026-08-12',
          revokedFrom: null,
        },
      ],
    });
    const delegate = result.holders.find(
      (holder) => holder.employeeRecordId === 'employee-record'
    );

    expect(delegate?.source.kind).toBe('delegation');
    expect(
      delegate ? canHolderApproveTarget(delegate, 'someone', 'buero') : true
    ).toBe(false);
    expect(
      delegate ? canHolderApproveTarget(delegate, 'someone', 'employee') : false
    ).toBe(true);
  });

  test('resolves overlapping anomalous delegations independently of input order', () => {
    const delegations: ResponsibilityDelegation[] = [
      {
        id: 'older-delegation',
        responsibility: 'time_approval',
        delegatorEmployeeRecordId: 'admin-record',
        substituteEmployeeRecordId: 'employee-record',
        validFrom: '2026-08-09',
        validUntil: '2026-08-15',
        revokedFrom: null,
      },
      {
        id: 'newer-delegation',
        responsibility: 'time_approval',
        delegatorEmployeeRecordId: 'buero-record',
        substituteEmployeeRecordId: 'employee-record',
        validFrom: '2026-08-10',
        validUntil: '2026-08-12',
        revokedFrom: null,
      },
    ];
    const resolve = (inputDelegations: ResponsibilityDelegation[]) =>
      resolveEffectiveResponsibility({
        responsibility: 'time_approval',
        actionTime: '2026-08-10T10:00:00.000Z',
        businessDate: '2026-08-10',
        members,
        configurations: [],
        delegations: inputDelegations,
      });

    const forward = resolve(delegations).holders.find(
      (holder) => holder.employeeRecordId === 'employee-record'
    );
    const reversed = resolve(delegations.toReversed()).holders.find(
      (holder) => holder.employeeRecordId === 'employee-record'
    );

    expect(forward?.source).toEqual(reversed?.source);
    expect(forward?.source.kind).toBe('delegation');
    if (forward?.source.kind === 'delegation') {
      expect(forward.source.delegationId).toBe('newer-delegation');
    }
  });

  test('never allows a holder to approve their own entry', () => {
    const result = resolveEffectiveResponsibility({
      responsibility: 'time_approval',
      actionTime: '2026-08-05T10:00:00.000Z',
      businessDate: '2026-08-05',
      members,
      configurations: [directConfiguration],
      delegations: [],
    });
    const holder = result.holders[0];

    expect(holder).toBeDefined();
    expect(holder && canHolderApproveTarget(holder, 'buero-user', 'buero')).toBe(
      false
    );
  });

  test('detects a sole selected base holder even when a substitute is active', () => {
    const timeApproval = resolveWithDelegation('2026-08-10', {
      id: 'delegation',
      responsibility: 'time_approval',
      delegatorEmployeeRecordId: 'buero-record',
      substituteEmployeeRecordId: 'employee-record',
      validFrom: '2026-08-10',
      validUntil: '2026-08-12',
      revokedFrom: null,
    });
    const leaveApproval = resolveEffectiveResponsibility({
      responsibility: 'leave_approval',
      actionTime: '2026-08-10T10:00:00.000Z',
      businessDate: '2026-08-10',
      members,
      configurations: [],
      delegations: [],
    });

    expect(
      getResponsibilitiesStrandedByEmployeeRemoval(
        { time_approval: timeApproval, leave_approval: leaveApproval },
        'buero-record'
      )
    ).toEqual(['time_approval']);
  });
});
