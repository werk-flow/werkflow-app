import { expect, test } from 'bun:test';
import { partyLinks, resolveBillingVersions, standInsByRead } from './resolve';

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

test('a read keeps the customer it came with, also after a later read names another', () => {
  const standIns = standInsByRead();
  const firstRead = { versions: [] };
  const laterRead = { versions: [] };
  standIns.remember(firstRead, customer);
  standIns.remember(firstRead, manager);
  standIns.remember(laterRead, manager);
  expect(standIns.clientFor(firstRead)).toEqual(customer);
  expect(standIns.clientFor(laterRead)).toEqual(manager);
  expect(standIns.clientFor({ versions: [] })).toBeNull();
});

test('the work’s own customer and a recipient that is the Auftraggeber get no second link', () => {
  const version = { version: 1, source: 'auftraggeber' as const, setAt: '2026-11-12T08:00:00Z' };
  expect(partyLinks({ ...version, auftraggeber: customer, recipient: customer }, customer.id)).toEqual({
    auftraggeber: false,
    recipient: false,
  });
  expect(partyLinks({ ...version, auftraggeber: customer, recipient: manager }, customer.id)).toEqual({
    auftraggeber: false,
    recipient: true,
  });
  expect(partyLinks({ ...version, auftraggeber: manager, recipient: manager }, customer.id)).toEqual({
    auftraggeber: true,
    recipient: false,
  });
});
