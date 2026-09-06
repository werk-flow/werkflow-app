import { describe, expect, test } from 'bun:test';
import { assertWorldSeedComplete, planTestWorld, seedOwnedWorld } from './seed-world-plan';

describe('owned seed initialization', () => {
  test('reserves collision-resistant identities with bounded test email lengths', () => {
    const worlds = [planTestWorld(), planTestWorld()];
    expect(worlds[0]!.runId).toMatch(/^[a-f0-9]{32}$/);
    expect(worlds[0]!.runId).not.toBe(worlds[1]!.runId);
    const identities: string[] = [];
    for (const world of worlds) {
      identities.push(world.orgId, world.outsider.orgId, world.inventory.itemId, world.inventory.locationId);
      for (const user of [...Object.values(world.users), world.invitee, world.removableEmployee, world.personnelInvitee, world.outsider.admin]) {
        identities.push(user.id);
        expect(user.email.split('@')[0]!.length).toBeLessThanOrEqual(64);
      }
    }
    expect(new Set(identities).size).toBe(identities.length);
  });

  test('failed ownership recording prevents the first resource write', async () => {
    let writes = 0;
    const world = planTestWorld();
    await expect(seedOwnedWorld({
      world,
      recordOwnership: async () => { throw new Error('archive unavailable'); },
      createResources: async () => { writes += 1; },
    })).rejects.toThrow('archive unavailable');
    expect(writes).toBe(0);
    expect(world.seedStatus).toBe('seeding');
  });

  test('failure after a resource write leaves every reserved cleanup identity recorded', async () => {
    const world = planTestWorld();
    let recorded = '';
    let createdUserId: string | undefined;
    await expect(seedOwnedWorld({
      world,
      recordOwnership: (planned) => { recorded = JSON.stringify(planned); },
      createResources: async (planned) => {
        expect(recorded).toContain(planned.users.admin.id);
        expect(recorded).toContain(planned.outsider.orgId);
        createdUserId = planned.users.admin.id;
        throw new Error('response lost after auth insert');
      },
    })).rejects.toThrow('response lost after auth insert');
    expect(recorded).toContain(createdUserId!);
    expect(world.seedStatus).toBe('seeding');
    expect(() => assertWorldSeedComplete(world)).toThrow('incomplete seed');
  });

  test('only completed initialization permits diagnostic reuse, while legacy complete worlds remain readable', async () => {
    const world = await seedOwnedWorld({ world: planTestWorld(), recordOwnership: () => undefined, createResources: async () => undefined });
    expect(world.seedStatus).toBe('ready');
    expect(() => assertWorldSeedComplete(world)).not.toThrow();
    expect(() => assertWorldSeedComplete({})).not.toThrow();
  });
});
