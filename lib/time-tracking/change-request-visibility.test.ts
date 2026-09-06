import { describe, expect, test } from 'bun:test';
import { canViewChangeRequest } from './change-request-visibility';

const orgA = '11111111-1111-1111-1111-111111111111';
const orgB = '22222222-2222-2222-2222-222222222222';
const me = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('canViewChangeRequest', () => {
  test('a request from a foreign organization is never visible', () => {
    expect(
      canViewChangeRequest(
        { organizationId: orgB, requestedBy: me, entryUserId: me },
        { userId: me, roleByOrganization: new Map([[orgA, 'admin']]) }
      )
    ).toBe(false);
  });

  test('managers see every request in their organization', () => {
    for (const role of ['admin', 'buero'] as const) {
      expect(
        canViewChangeRequest(
          { organizationId: orgA, requestedBy: other, entryUserId: other },
          { userId: me, roleByOrganization: new Map([[orgA, role]]) }
        )
      ).toBe(true);
    }
  });

  test('employees see only requests they raised or that concern their entries', () => {
    const caller = {
      userId: me,
      roleByOrganization: new Map([[orgA, 'employee' as const]]),
    };
    expect(
      canViewChangeRequest({ organizationId: orgA, requestedBy: me, entryUserId: other }, caller)
    ).toBe(true);
    expect(
      canViewChangeRequest({ organizationId: orgA, requestedBy: other, entryUserId: me }, caller)
    ).toBe(true);
    expect(
      canViewChangeRequest({ organizationId: orgA, requestedBy: other, entryUserId: other }, caller)
    ).toBe(false);
    expect(
      canViewChangeRequest({ organizationId: orgA, requestedBy: other, entryUserId: null }, caller)
    ).toBe(false);
  });
});
