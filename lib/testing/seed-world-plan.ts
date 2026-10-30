import { randomUUID } from 'node:crypto';
import type { TestUser, TestWorld } from '../../tests/golden/support/world';

export type PlannedTestWorld = TestWorld & { seedStatus: 'seeding' | 'ready' };

/**
 * Geist's widest glyph at the run id's full length. A run id alone renders
 * between 32 narrow `f` and 32 wide `0`, so a name that does not wrap used to
 * overflow only on runs whose id rendered wide. This part is wider than any run
 * id and the same on every run, so a missing wrap fails every run.
 */
const WORST_CASE_UNBROKEN_PART = 'W'.repeat(32);

/** A world name: its label, the fixed worst-case unbroken part, and the run id that keeps it unique per run. */
export function worldName(label: string, runId: string): string {
  return `${label} ${WORST_CASE_UNBROKEN_PART} ${runId}`;
}

/** Reserve every cleanup identity before the first external write, including requests with uncertain responses. */
export function planTestWorld(): PlannedTestWorld {
  const runId = randomUUID().replaceAll('-', '');
  function user(role: string, firstName: string, surnamePrefix = 'Golden', emailOverride?: string): TestUser {
    return {
      id: randomUUID(),
      email: emailOverride ?? `gg-${role}-${runId}@werkflow-golden.test`,
      password: `GgTest!${runId}#2026`,
      firstName,
      lastName: worldName(surnamePrefix, runId),
    };
  }
  return {
    runId,
    seedStatus: 'seeding',
    orgId: randomUUID(),
    orgName: worldName('Golden Test SHK', runId),
    users: {
      admin: user('admin', 'Greta'),
      buero: user('buero', 'Bruno'),
      employee: user('employee', 'Emil'),
    },
    invitee: user('invitee', 'Ida', 'Golden', `delivered+gg-${runId}@resend.dev`),
    removableEmployee: user('removable', 'Rudi'),
    personnelInvitee: user('personnel-invitee', 'Nora', 'Neuling', `delivered+gg-p103-${runId}@resend.dev`),
    outsider: {
      orgId: randomUUID(),
      orgName: worldName('Fremde Firma', runId),
      admin: user('outsider', 'Otto', 'Fremd'),
    },
    inventory: {
      itemId: randomUUID(),
      itemName: worldName('Kupferrohr 15 mm', runId),
      locationId: randomUUID(),
      locationName: 'Hauptlager (Golden)',
      initialQuantity: 20,
    },
  };
}

export async function seedOwnedWorld(input: {
  world: PlannedTestWorld;
  recordOwnership: (world: PlannedTestWorld) => void | Promise<void>;
  createResources: (world: PlannedTestWorld) => Promise<void>;
}): Promise<TestWorld> {
  await input.recordOwnership(input.world);
  await input.createResources(input.world);
  input.world.seedStatus = 'ready';
  return input.world;
}

export function assertWorldSeedComplete(world: Pick<TestWorld, 'seedStatus'>): void {
  if (world.seedStatus === 'seeding') {
    throw new Error(
      'This run retains an incomplete seed. Clean its recorded world before starting fresh; it cannot be replayed as a diagnostic.',
    );
  }
}
