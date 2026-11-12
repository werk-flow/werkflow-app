import { expect, test } from 'bun:test';
import { resolveBillingVersions } from './resolve';

const customer = { id: 'c1', name: 'WEG Lindenstraße 5', address: 'Lindenstraße 5, 10115 Berlin' };
const manager = { id: 'c2', name: 'Hausverwaltung Lindenhof GmbH', address: 'Hofweg 1, 10117 Berlin' };

test('a party the job read left out is the job customer; a named one stays as frozen', () => {
  const [resolved] = resolveBillingVersions(
    [{ version: 2, source: 'objekt', setAt: '2026-11-12T08:00:00Z', auftraggeber: null, recipient: manager }],
    customer,
  );
  expect(resolved?.auftraggeber).toEqual(customer);
  expect(resolved?.recipient).toEqual(manager);
});

test('a left-out party without a job customer to stand in drops the version', () => {
  expect(
    resolveBillingVersions(
      [
        {
          version: 1,
          source: 'auftraggeber',
          setAt: '2026-11-12T08:00:00Z',
          auftraggeber: null,
          recipient: null,
        },
      ],
      null,
    ),
  ).toEqual([]);
});
