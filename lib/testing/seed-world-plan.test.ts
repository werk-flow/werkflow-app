import { describe, expect, test } from 'bun:test';
import { assertWorldSeedComplete, planTestWorld, seedOwnedWorld, worldName } from './seed-world-plan';
import { expectDefined } from './spec-support/expect-defined';

describe('owned seed initialization', () => {
  test('reserves collision-resistant identities with bounded test email lengths', () => {
    const worlds = [planTestWorld(), planTestWorld()];
    expect(expectDefined(worlds[0]).runId).toMatch(/^[a-f0-9]{32}$/);
    expect(expectDefined(worlds[0]).runId).not.toBe(expectDefined(worlds[1]).runId);
    const identities: string[] = [];
    for (const world of worlds) {
      identities.push(world.orgId, world.outsider.orgId, world.inventory.itemId, world.inventory.locationId);
      for (const user of [
        ...Object.values(world.users),
        world.invitee,
        world.removableEmployee,
        world.personnelInvitee,
        world.outsider.admin,
      ]) {
        identities.push(user.id);
        expect(expectDefined(user.email.split('@')[0]).length).toBeLessThanOrEqual(64);
      }
    }
    expect(new Set(identities).size).toBe(identities.length);
  });

  test('every world name ends in the same worst-case unbroken part and its own run id', () => {
    const worlds = [planTestWorld(), planTestWorld()];
    const unbrokenParts = new Set<string>();
    for (const world of worlds) {
      const users = [
        ...Object.values(world.users),
        world.invitee,
        world.removableEmployee,
        world.personnelInvitee,
        world.outsider.admin,
      ];
      for (const name of [
        world.orgName,
        world.outsider.orgName,
        world.inventory.itemName,
        ...users.map((user) => user.lastName),
      ]) {
        const parts = name.split(' ');
        expect(parts.at(-1)).toBe(world.runId);
        unbrokenParts.add(expectDefined(parts.at(-2)));
      }
    }
    expect([...unbrokenParts]).toEqual(['W'.repeat(32)]);
    expect(worldName('Kunde', expectDefined(worlds[0]).runId)).not.toBe(
      worldName('Kunde', expectDefined(worlds[1]).runId),
    );
  });

  test('failed ownership recording prevents the first resource write', async () => {
    let writes = 0;
    const world = planTestWorld();
    await expect(
      seedOwnedWorld({
        world,
        recordOwnership: async () => {
          throw new Error('archive unavailable');
        },
        createResources: async () => {
          writes += 1;
        },
      }),
    ).rejects.toThrow('archive unavailable');
    expect(writes).toBe(0);
    expect(world.seedStatus).toBe('seeding');
  });

  test('failure after a resource write leaves every reserved cleanup identity recorded', async () => {
    const world = planTestWorld();
    let recorded = '';
    let createdUserId: string | undefined;
    await expect(
      seedOwnedWorld({
        world,
        recordOwnership: (planned) => {
          recorded = JSON.stringify(planned);
        },
        createResources: async (planned) => {
          expect(recorded).toContain(planned.users.admin.id);
          expect(recorded).toContain(planned.outsider.orgId);
          createdUserId = planned.users.admin.id;
          throw new Error('response lost after auth insert');
        },
      }),
    ).rejects.toThrow('response lost after auth insert');
    expect(recorded).toContain(expectDefined(createdUserId));
    expect(world.seedStatus).toBe('seeding');
    expect(() => assertWorldSeedComplete(world)).toThrow('incomplete seed');
  });

  test('only completed initialization permits diagnostic reuse, while legacy complete worlds remain readable', async () => {
    const world = await seedOwnedWorld({
      world: planTestWorld(),
      recordOwnership: () => undefined,
      createResources: async () => undefined,
    });
    expect(world.seedStatus).toBe('ready');
    expect(() => assertWorldSeedComplete(world)).not.toThrow();
    expect(() => assertWorldSeedComplete({})).not.toThrow();
  });
});
