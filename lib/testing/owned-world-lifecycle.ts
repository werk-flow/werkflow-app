import type { RunManifest } from '../../tests/golden/support/run-state';
import type { TestWorld } from '../../tests/golden/support/world';

/** Every destroyed world is closed, including suites without audit groups. */
export function completedWorldCleanup(
  world: Pick<TestWorld, 'runId' | 'orgId' | 'auditGroup'> & { outsider: Pick<TestWorld['outsider'], 'orgId'> },
  manifest: Pick<RunManifest, 'completedAuditGroups'>,
  cleanedAt: string,
): Pick<RunManifest, 'cleanedAt' | 'retainedAt' | 'completedAuditGroups'> {
  return {
    cleanedAt,
    retainedAt: null,
    ...(world.auditGroup ? {
      completedAuditGroups: [...(manifest.completedAuditGroups ?? []), {
        group: world.auditGroup,
        runId: world.runId,
        organizationIds: [world.orgId, world.outsider.orgId],
        cleanedAt,
      }],
    } : {}),
  };
}

function retainOwnedFailure(error: unknown, evidence: {
  retain: (error: unknown) => void;
  archive: () => void;
}): never {
  try {
    evidence.retain(error);
    evidence.archive();
  } catch (evidenceError) {
    throw new AggregateError([error, evidenceError], 'Owned-world cleanup failed and its evidence could not be fully recorded. No leftover sweep was attempted.');
  }
  throw error;
}

/** A green test result cannot release ownership when its world file is unreadable. */
export function retainUnreadableOwnedWorld(
  world: RunManifest['world'],
  error: unknown,
  evidence: { retain: (error: unknown) => void; archive: () => void },
): void {
  if (world) retainOwnedFailure(error, evidence);
}

/** Record successful owned cleanup, or retain the failure and its evidence. */
export async function finishOwnedWorldCleanup(input: {
  destroy: () => Promise<void>;
  recordCleaned: () => void;
  retain: (error: unknown) => void;
  archive: () => void;
}): Promise<void> {
  try {
    await input.destroy();
  } catch (cleanupError) {
    retainOwnedFailure(cleanupError, input);
  }
  try {
    input.recordCleaned();
  } catch (error) {
    throw new Error('Owned resources were deleted, but cleanup completion could not be recorded. Ownership remains uncertain; no leftover sweep was attempted.', { cause: error });
  }
}

/** Retire the previous owner before creating and initializing its replacement. */
export async function replaceOwnedWorld<World>(input: {
  previous: World;
  destroy: (world: World) => Promise<void>;
  retired: (world: World) => void;
  create: () => Promise<World>;
  persist: (world: World) => void;
  initialize: (world: World) => Promise<void>;
}): Promise<World> {
  await input.destroy(input.previous);
  input.retired(input.previous);
  const replacement = await input.create();
  input.persist(replacement);
  await input.initialize(replacement);
  return replacement;
}
