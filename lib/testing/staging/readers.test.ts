// A staging reader returns one organization's ids and states, and Stripe answers only from the sandbox.
import { expect, test } from 'bun:test';

import { sandboxAnswer, scopedReadQuery } from './readers';

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

test('a column that may hold personal data, or SQL in a name or an id, refuses the read', () => {
  for (const columns of [['recipient'], ['name'], ['email'], ['id', 'notes'], ['id; drop table x'], []])
    expect(() =>
      scopedReadQuery({ table: 'werkflow_billing_mails', columns, organizationId: ORGANIZATION }),
    ).toThrow();
  expect(() =>
    scopedReadQuery({ table: 'auth.users', columns: ['id'], organizationId: ORGANIZATION }),
  ).toThrow();
  expect(() =>
    scopedReadQuery({ table: 'organizations', columns: ['id'], organizationId: "x' or true --" }),
  ).toThrow();
});

test('Stripe objects and lists pass only with livemode false on each', () => {
  expect(sandboxAnswer({ id: 'sub_1', livemode: false, status: 'active' })).toEqual({
    id: 'sub_1',
    livemode: false,
    status: 'active',
  });
  expect(sandboxAnswer({ object: 'list', data: [{ livemode: false }] }).object).toBe('list');
  for (const body of [
    { id: 'sub_1', livemode: true },
    { id: 'sub_1' },
    { object: 'list', data: [{ livemode: false }, { livemode: true }] },
    null,
  ])
    expect(() => sandboxAnswer(body)).toThrow(/sandbox/);
});
