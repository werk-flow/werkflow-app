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
