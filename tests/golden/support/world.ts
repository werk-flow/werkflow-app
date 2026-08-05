import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type TestRole = 'admin' | 'buero' | 'employee';

export type TestUser = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

// One disposable, organization-isolated "world" per test run: a primary
// organization with all three roles, plus a second organization owned by an
// unrelated admin to assert organization boundaries.
export type TestWorld = {
  runId: string;
  orgId: string;
  orgName: string;
  users: Record<TestRole, TestUser>;
  // A confirmed user without any membership; joins the primary organization
  // through the real invite flow during the gate. Uses a Resend test address
  // (delivered+...@resend.dev) so the invite email sends without bouncing.
  invitee: TestUser;
  // P1-03: an employee member whose destructive removal the personnel spec
  // exercises; no other spec may depend on this member.
  removableEmployee: TestUser;
  // P1-03: a confirmed user without membership who redeems an invite that was
  // sent from a personnel record, proving record-to-login linking.
  personnelInvitee: TestUser;
  // Seeded inventory master data for the take/return scenario. Stock is
  // seeded through record_inventory_movement so the ledger starts consistent.
  inventory: {
    itemId: string;
    itemName: string;
    locationId: string;
    locationName: string;
    initialQuantity: number;
  };
  outsider: {
    orgId: string;
    orgName: string;
    admin: TestUser;
  };
};

export const ARTIFACTS_DIR = resolve(__dirname, '../.artifacts');

export function worldFilePath(): string {
  return resolve(ARTIFACTS_DIR, 'world.json');
}

export function storageStatePath(role: TestRole | 'outsider'): string {
  return resolve(ARTIFACTS_DIR, `${role}.json`);
}

export function saveWorld(world: TestWorld): void {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(worldFilePath(), JSON.stringify(world, null, 2));
}

export function loadWorld(): TestWorld {
  return JSON.parse(readFileSync(worldFilePath(), 'utf8')) as TestWorld;
}
