import { expect, test } from 'bun:test';
import { assertLocalCleanupRelocation, assertRelocatedWorldOwnership } from './local-cleanup-relocation';
import type { BackendProvenance } from './test-evidence';
import { validateDiagnosticProvenance } from './test-evidence';
import type { TestWorld } from '../../tests/golden/support/world';

const backend = (origin: string): BackendProvenance => ({ suite: 'audit', target: 'local', backendOrigin: origin, r2Bucket: 'werkflow-documents-local', storageEndpoint: `${origin}/storage/v1/s3` });
const recorded = backend('http://172.25.1.1:54321');
const current = backend('http://172.19.1.1:54321');

test('local cleanup relocation accepts only local API and storage transport changes; replay stays strict', () => {
  expect(() => assertLocalCleanupRelocation(recorded, current)).not.toThrow();
  expect(validateDiagnosticProvenance(recorded, current)).toHaveLength(2);
  for (const invalid of [
    { ...current, target: 'cloud' as const }, { ...current, suite: 'golden' as const },
    { ...current, r2Bucket: 'production' }, { ...current, storageEndpoint: `${recorded.backendOrigin}/storage/v1/s3` },
    backend('https://example.supabase.co'), backend('http://172.19.example:54321'),
    backend('http://8.8.8.8:54321'), backend('http://172.19.1.1:8000'), backend('http://user@172.19.1.1:54321'),
  ]) expect(() => assertLocalCleanupRelocation(recorded, invalid)).toThrow();
  expect(() => assertLocalCleanupRelocation(undefined, current)).toThrow();
  expect(() => assertLocalCleanupRelocation({ ...recorded, target: 'cloud' }, current)).toThrow();
});

test('local cleanup relocation requires both exact organization names and owners, not a missing or coincidental ID', () => {
  const user = { id: 'admin', email: 'admin@test', password: '', firstName: '', lastName: '' };
  const world: TestWorld = {
    runId: 'owned-run', orgId: 'primary', orgName: 'Golden Test SHK owned-run',
    users: { admin: user, buero: user, employee: user }, invitee: user, removableEmployee: user, personnelInvitee: user,
    inventory: { itemId: '', itemName: '', locationId: '', locationName: '', initialQuantity: 0 },
    outsider: { orgId: 'other', orgName: 'Fremde Firma owned-run', admin: { ...user, id: 'outsider' } },
  };
  const rows = [{ id: 'primary', name: world.orgName, admin_id: 'admin' }, { id: 'other', name: world.outsider.orgName, admin_id: 'outsider' }] as const;
  expect(() => assertRelocatedWorldOwnership(world, rows)).not.toThrow();
  for (const invalid of [[], rows.slice(0, 1), [rows[0], rows[0]],
    [{ ...rows[0], name: 'Customer company' }, rows[1]],
    [{ ...rows[0], admin_id: 'unrelated' }, rows[1]],
    [rows[0], { ...rows[1], id: 'unrelated' }],
  ]) expect(() => assertRelocatedWorldOwnership(world, invalid)).toThrow();
  expect(() => assertRelocatedWorldOwnership({ ...world, runId: 'different' }, rows)).toThrow();
});
