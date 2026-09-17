import { localMailpitUrl } from './local-mailpit';
import type { BackendProvenance } from './test-evidence';
import type { TestWorld } from '../../tests/golden/support/world';

/** This exception authorizes cleanup only, never replay or acceptance. */
export function assertLocalCleanupRelocation(recorded: BackendProvenance | undefined, current: BackendProvenance): void {
  if (!recorded || recorded.target !== 'local' || current.target !== 'local' || recorded.suite !== current.suite) {
    throw new Error('Relocated cleanup requires matching recorded local targets and suites.');
  }
  for (const backend of [recorded, current]) {
    if (!localMailpitUrl(backend.backendOrigin) || backend.r2Bucket !== 'werkflow-documents-local' ||
        backend.storageEndpoint !== `${backend.backendOrigin}/storage/v1/s3`) {
      throw new Error('Relocated cleanup requires the exact local Supabase API and storage endpoints.');
    }
  }
}

export type CleanupOrganizationIdentity = { id: string; name: string; admin_id: string };

export function assertRelocatedWorldOwnership(world: TestWorld, observed: readonly CleanupOrganizationIdentity[]): void {
  const expected = [
    { id: world.orgId, name: world.orgName, admin_id: world.users.admin.id, prefix: 'Golden Test SHK ' },
    { id: world.outsider.orgId, name: world.outsider.orgName, admin_id: world.outsider.admin.id, prefix: 'Fremde Firma ' },
  ] as const;
  if (observed.length !== 2 || expected[0].id === expected[1].id || expected.some((identity) =>
    !identity.name.startsWith(identity.prefix) || !identity.name.includes(world.runId) ||
    !observed.some((row) => row.id === identity.id && row.name === identity.name && row.admin_id === identity.admin_id)
  )) throw new Error('The relocated backend does not contain both exact recorded test organizations and owners. No cleanup is authorized.');
}
