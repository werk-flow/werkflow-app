import { describe, expect, test } from 'bun:test';

import {
  approvalTargetRole,
  canHolderApproveTarget,
  getResponsibilitiesStrandedByEmployeeRemoval,
  getNextSelectedHolderAccessChangeAt,
  resolveEffectiveResponsibility,
  type ResponsibilityConfiguration,
  type ResponsibilityDelegation,
  type ResponsibilityMember,
} from './resolution';
import type { OrganizationResponsibility } from './types';

const members: ResponsibilityMember[] = [
  {
    employeeRecordId: 'admin-record',
    userId: 'admin-user',
    role: 'admin',
    active: true,
    hasExitDate: false,
    hasEffectiveAccess: true,
  },
  {
    employeeRecordId: 'buero-record',
    userId: 'buero-user',
    role: 'buero',
    active: true,
    hasExitDate: false,
    hasEffectiveAccess: true,
  },
  {
    employeeRecordId: 'employee-record',
    userId: 'employee-user',
    role: 'employee',
    active: true,
    hasExitDate: false,
    hasEffectiveAccess: true,
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

function resolveWithDelegation(businessDate: string, delegation: ResponsibilityDelegation) {
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
    expect(result.holders.map((holder) => holder.userId)).toEqual(['admin-user', 'buero-user']);
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
      revokedOn: null,
    });

    expect(result.holders.some((holder) => holder.employeeRecordId === 'employee-record')).toBe(expected);
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
      revokedOn: '2026-08-13',
    };

    expect(resolveWithDelegation('2026-08-12', delegation).holders).toHaveLength(2);
    expect(resolveWithDelegation('2026-08-13', delegation).holders).toHaveLength(1);
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
          revokedOn: null,
        },
      ],
    });
    const delegate = result.holders.find((holder) => holder.employeeRecordId === 'employee-record');

    expect(delegate?.source.kind).toBe('delegation');
    expect(delegate ? canHolderApproveTarget(delegate, 'someone', 'buero') : true).toBe(false);
    expect(delegate ? canHolderApproveTarget(delegate, 'someone', 'employee') : false).toBe(true);
  });

  test('a suspended, ended or prestart delegator hands no scope to their substitute', () => {
    const delegation: ResponsibilityDelegation = {
      id: 'delegation',
      responsibility: 'time_approval',
      delegatorEmployeeRecordId: 'buero-record',
      substituteEmployeeRecordId: 'employee-record',
      validFrom: '2026-08-10',
      validUntil: '2026-08-12',
      revokedFrom: null,
      revokedOn: null,
    };
    const result = resolveEffectiveResponsibility({
      responsibility: 'time_approval',
      actionTime: '2026-08-10T10:00:00.000Z',
      businessDate: '2026-08-10',
      members: members.map((member) =>
        member.employeeRecordId === 'buero-record' ? { ...member, hasEffectiveAccess: false } : member,
      ),
      configurations: [directConfiguration],
      delegations: [delegation],
    });

    expect(result.holders.map((holder) => holder.employeeRecordId)).toEqual(['buero-record']);
    expect(
      resolveWithDelegation('2026-08-10', delegation).holders.map((holder) => holder.employeeRecordId),
    ).toEqual(['buero-record', 'employee-record']);
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
        revokedOn: null,
      },
      {
        id: 'newer-delegation',
        responsibility: 'time_approval',
        delegatorEmployeeRecordId: 'buero-record',
        substituteEmployeeRecordId: 'employee-record',
        validFrom: '2026-08-10',
        validUntil: '2026-08-12',
        revokedFrom: null,
        revokedOn: null,
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
      (holder) => holder.employeeRecordId === 'employee-record',
    );
    const reversed = resolve(delegations.toReversed()).holders.find(
      (holder) => holder.employeeRecordId === 'employee-record',
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
    expect(holder && canHolderApproveTarget(holder, 'buero-user', 'buero')).toBe(false);
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
      revokedOn: null,
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
        'buero-record',
      ),
    ).toEqual(['time_approval']);
  });

  // The database's last-holder checks count another holder only with no exit
  // date and with effective access (werk-flow/werkflow-planning#591).
  test.each([
    ['with effective access and no exit date', {}, []],
    ['without effective access', { hasEffectiveAccess: false }, ['time_approval']],
    ['with a planned exit date', { hasExitDate: true }, ['time_approval']],
    [
      'after the exit date',
      { active: false, hasExitDate: true, hasEffectiveAccess: false },
      ['time_approval'],
    ],
  ] satisfies [string, Partial<ResponsibilityMember>, OrganizationResponsibility[]][])(
    'the removal precheck counts a co-holder %s as the database does',
    (_, coHolderState, stranded) => {
      const twoHolders: ResponsibilityConfiguration = {
        ...directConfiguration,
        assignments: [
          ...directConfiguration.assignments,
          {
            id: 'co-holder-assignment',
            configurationId: 'selected-version',
            employeeRecordId: 'admin-record',
            source: 'direct',
            roleSnapshot: null,
          },
        ],
      };
      const timeApproval = resolveEffectiveResponsibility({
        responsibility: 'time_approval',
        actionTime: '2026-08-10T10:00:00.000Z',
        businessDate: '2026-08-10',
        members: members.map((member) =>
          member.employeeRecordId === 'admin-record' ? { ...member, ...coHolderState } : member,
        ),
        configurations: [twoHolders],
        delegations: [],
      });

      expect(
        getResponsibilitiesStrandedByEmployeeRemoval({ time_approval: timeApproval }, 'buero-record'),
      ).toEqual(stranded);
    },
  );
});

describe('approval scope over a personnel record', () => {
  const holders = resolveEffectiveResponsibility({
    responsibility: 'time_approval',
    actionTime: '2026-08-05T10:00:00.000Z',
    businessDate: '2026-08-05',
    members,
    configurations: [],
    delegations: [],
  }).holders;
  const holderOf = (userId: string) => {
    const holder = holders.find((candidate) => candidate.userId === userId);
    if (!holder) throw new Error(`${userId} holds no time approval`);
    return holder;
  };

  test('a person without a login counts as an employee, a login without a membership has no role', () => {
    expect(approvalTargetRole(null, null)).toBe('employee');
    expect(approvalTargetRole('former-user', null)).toBeNull();
    expect(approvalTargetRole('buero-user', 'buero')).toBe('buero');
  });

  test('a Büro default decides a person without a login, never a person without a known role', () => {
    const buero = holderOf('buero-user');
    expect(canHolderApproveTarget(buero, null, approvalTargetRole(null, null))).toBe(true);
    expect(canHolderApproveTarget(buero, 'former-user', approvalTargetRole('former-user', null))).toBe(false);
  });

  test('an Admin default decides a person without a known role, never themselves', () => {
    const admin = holderOf('admin-user');
    expect(canHolderApproveTarget(admin, 'former-user', null)).toBe(true);
    expect(canHolderApproveTarget(admin, 'admin-user', 'admin')).toBe(false);
  });
});

describe('selected holder access deadline', () => {
  const now = Date.parse('2026-08-10T10:00:00.000Z');
  const resolve = (
    responsibility: OrganizationResponsibility,
    configurations: ResponsibilityConfiguration[],
  ) =>
    resolveEffectiveResponsibility({
      responsibility,
      actionTime: new Date(now).toISOString(),
      businessDate: '2026-08-10',
      members,
      configurations,
      delegations: [],
    });
  const baseHolder = {
    employeeRecordId: 'buero-record',
    userId: 'buero-user',
    isLastingHolder: true,
    source: {
      kind: 'direct_assignment',
      configurationId: 'selected-version',
      assignmentId: 'direct-assignment',
    },
  } as const;
  const effective = {
    time_approval: resolve('time_approval', [directConfiguration]),
    leave_approval: resolve('leave_approval', []),
  };

  test('only selected base holders set the earliest future access deadline', () => {
    const schedules = new Map([
      ['buero-record', '2026-08-10T12:00:00.000Z'],
      ['admin-record', '2026-08-10T11:00:00.000Z'],
      ['unrelated-record', '2026-08-10T10:01:00.000Z'],
    ]);
    expect(getNextSelectedHolderAccessChangeAt(effective, schedules, now)).toBe('2026-08-10T12:00:00.000Z');
    expect(
      getNextSelectedHolderAccessChangeAt(effective, schedules, Date.parse('2026-08-10T12:00:00.000Z')),
    ).toBeNull();
    expect(getNextSelectedHolderAccessChangeAt(effective, new Map(), now)).toBeNull();
  });

  test('the earliest of several selected base holders wins, ignoring past and due steps', () => {
    const selected = {
      ...effective.time_approval,
      holders: [
        ...effective.time_approval.holders,
        { ...baseHolder, employeeRecordId: 'later' },
        { ...baseHolder, employeeRecordId: 'past' },
        { ...baseHolder, employeeRecordId: 'due' },
        {
          ...baseHolder,
          employeeRecordId: 'delegate',
          source: {
            kind: 'delegation' as const,
            configurationId: 'selected-version',
            delegationId: 'delegation',
            delegatedFromEmployeeRecordId: 'buero-record',
            validFrom: '2026-08-10',
            validUntil: '2026-08-11',
            inheritedSource: baseHolder.source,
          },
        },
      ],
    };
    expect(
      getNextSelectedHolderAccessChangeAt(
        { time_approval: selected },
        new Map([
          ['buero-record', '2026-08-10T12:00:00.000Z'],
          ['later', '2026-08-10T13:00:00.000Z'],
          ['past', '2026-08-10T09:00:00.000Z'],
          ['due', '2026-08-10T10:00:00.000Z'],
          ['delegate', '2026-08-10T10:01:00.000Z'],
        ]),
        now,
      ),
    ).toBe('2026-08-10T12:00:00.000Z');
  });
});
