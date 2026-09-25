import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { browserRunPaths, configuredRunKey } from '../../../lib/testing/run-paths';
import { withFileLock, writeJsonAtomically } from '../../../lib/testing/file-lock';
import { addOwnedTestEmail, preserveOwnedTestEmails } from '../../../lib/testing/test-email-ownership';

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
  /** Absent on historical worlds. Incomplete seeds retain exact cleanup identities but cannot be replayed. */
  seedStatus?: 'seeding' | 'ready';
  /** Exact addresses reserved before UI signup or contact entry, including failed submissions. */
  additionalUserEmails?: string[];
  /** Audit worlds belong to exactly one spec-file group. */
  auditGroup?: string;
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

export function artifactsDirectory(runKey = configuredRunKey()): string {
  return browserRunPaths(resolve(__dirname, '../../..'), runKey).activeState;
}

export function worldFilePath(runKey = configuredRunKey()): string {
  return resolve(artifactsDirectory(runKey), 'world.json');
}

export function storageStatePath(role: TestRole | 'outsider', runKey = configuredRunKey()): string {
  return resolve(artifactsDirectory(runKey), `${role}.json`);
}

export function saveWorld(world: TestWorld): void {
  mkdirSync(artifactsDirectory(), { recursive: true });
  const path = worldFilePath();
  withFileLock(`${path}.lock`, () => {
    const previous = existsSync(path) ? loadWorld() : undefined;
    writeJsonAtomically(path, preserveOwnedTestEmails(world, previous));
  });
}

export function registerTestUserEmail(label: string, runId: string): string {
  const path = worldFilePath();
  return withFileLock(`${path}.lock`, () => {
    const { world, email } = addOwnedTestEmail({ world: loadWorld(), requestedRunId: runId, label });
    const archive = browserRunPaths(resolve(__dirname, '../../..'), configuredRunKey()).archivedState;
    writeJsonAtomically(path, world);
    // No UI write starts unless both active state and its retained recovery copy record ownership.
    writeJsonAtomically(resolve(archive, 'world.json'), world);
    return email;
  });
}

export function loadWorld(): TestWorld {
  return JSON.parse(readFileSync(worldFilePath(), 'utf8')) as TestWorld;
}
