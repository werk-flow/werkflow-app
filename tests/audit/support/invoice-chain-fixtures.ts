import {
  invoiceFixtureField,
  seedInvoiceChain,
  type InvoiceChainFixture,
} from '../../golden/support/db/invoices';
import type { TestWorld } from '../../golden/support/world';

/**
 * The world's invoice of `state` as `surfaceFixture`'s arguments: seeded once
 * per world, its value the JSON `parseInvoiceChain` reads.
 */
export function invoiceChainSeed(
  world: TestWorld,
  state: 'issued' | 'cancelled',
): { name: `commercial.${string}`; create: () => Promise<string> } {
  return {
    name: `commercial.invoice-chain-${state}`,
    create: async () =>
      JSON.stringify(
        await seedInvoiceChain({
          orgId: world.orgId,
          actorId: world.users.buero.id,
          customerName: `Hausverwaltung Lindenhof GmbH ${state} ${world.runId}`,
          state,
        }),
      ),
  };
}

/** The ids and numbers a seeded chain's fixture value holds. */
export function parseInvoiceChain(value: string): InvoiceChainFixture {
  const parsed: unknown = JSON.parse(value);
  const nullable = (key: string) =>
    Reflect.get(Object(parsed), key) === null ? null : invoiceFixtureField(parsed, key);
  return {
    originalId: invoiceFixtureField(parsed, 'originalId'),
    originalNumber: invoiceFixtureField(parsed, 'originalNumber'),
    stornoId: nullable('stornoId'),
    stornoNumber: nullable('stornoNumber'),
    correctionId: nullable('correctionId'),
  };
}
