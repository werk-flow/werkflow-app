// A staging reader returns one organization's allowlisted id, state, amount and time columns, and
// Stripe answers only from the sandbox, reduced to the same kind of fields.
import { expect, test } from 'bun:test';

import { pendingInviteCodeQuery, sandboxAnswer, scopedReadQuery } from './readers';

const ORGANIZATION = '0b9a6201-6971-4a37-a1d5-41c7fb6c179c';

test('a read is one table of one organization, with the organization as a parameter', () => {
  expect(
    scopedReadQuery({
      table: 'werkflow_billing_mails',
      columns: ['id', 'kind', 'state'],
      organizationId: ORGANIZATION,
    }),
  ).toEqual({
    query: 'select id, kind, state from public.werkflow_billing_mails where organization_id = $1::uuid',
    parameters: [ORGANIZATION],
  });
  expect(
    scopedReadQuery({ table: 'organizations', columns: ['id', 'created_at'], organizationId: ORGANIZATION })
      .query,
  ).toBe('select id, created_at from public.organizations where id = $1::uuid');
});

test('a column outside the allowlist, another table, or SQL in an id refuses the read', () => {
  for (const [table, columns] of [
    ['werkflow_billing_mails', ['recipient']],
    ['werkflow_invoices', ['buyer']],
    ['werkflow_invoices', ['line_names']],
    ['organizations', ['name']],
    // Address data and a free-text `_reason` on tables the allowlist does hold.
    ['organizations', ['postal_code']],
    ['werkflow_billing_mails', ['failure_reason']],
    // An id-like name on a table the allowlist does not hold, such as free text with a `_reason` suffix.
    ['maintenance_plan_revisions', ['overlap_reason']],
    ['auth.users', ['id']],
    ['werkflow_billing_mails', ['id; drop table x']],
    ['werkflow_billing_mails', []],
  ] as const)
    expect(
      () => scopedReadQuery({ table, columns, organizationId: ORGANIZATION }),
      `${table} ${columns.join()}`,
    ).toThrow();
  expect(() =>
    scopedReadQuery({ table: 'organizations', columns: ['id'], organizationId: "x' or true --" }),
  ).toThrow();
});

test("an invite code is read for one role of the run's organization, pending only", () => {
  expect(pendingInviteCodeQuery(ORGANIZATION, 'buero')).toEqual({
    query:
      "select invite_code from public.organization_invites where organization_id = $1::uuid and invited_role = $2::public.org_role and status = 'pending'",
    parameters: [ORGANIZATION, 'buero'],
  });
  expect(pendingInviteCodeQuery(ORGANIZATION, 'employee').parameters).toEqual([ORGANIZATION, 'employee']);
  expect(() => pendingInviteCodeQuery(ORGANIZATION, 'admin')).toThrow(/buero or employee/);
  expect(() => pendingInviteCodeQuery(ORGANIZATION, "buero' or true --")).toThrow(/buero or employee/);
  expect(() => pendingInviteCodeQuery("x' or true --", 'buero')).toThrow(/UUID/);
});

test('Stripe objects and lists pass only with livemode false on each, as their allowed fields', () => {
  expect(
    sandboxAnswer({
      id: 'sub_1',
      object: 'subscription',
      livemode: false,
      status: 'active',
      customer: { id: 'cus_1', email: 'payer@example.test', name: 'Made Up' },
      default_payment_method: { id: 'pm_1', billing_details: { name: 'Made Up' } },
      metadata: { werkflow_organization_id: ORGANIZATION },
    }),
  ).toEqual([{ id: 'sub_1', object: 'subscription', livemode: false, status: 'active', customer: 'cus_1' }]);
  expect(
    sandboxAnswer({
      object: 'list',
      data: [{ id: 'in_1', livemode: false, customer_email: 'payer@example.test', total: 149900 }],
    }),
  ).toEqual([{ id: 'in_1', livemode: false, total: 149900 }]);
  for (const body of [
    { id: 'sub_1', livemode: true },
    { id: 'sub_1' },
    { object: 'list', data: [{ livemode: false }, { livemode: true }] },
    { object: 'list', livemode: false, data: [{ livemode: true }] },
    null,
  ])
    expect(() => sandboxAnswer(body)).toThrow(/sandbox/);
});
