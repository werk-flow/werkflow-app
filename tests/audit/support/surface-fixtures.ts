import type { Page } from '@playwright/test';
import type { SurfaceRole } from '../../../lib/testing/selection/mobile-route-inventory';
import type { TestWorld } from '../../golden/support/world';
import { auditCheckpoint, saveAuditCheckpoint } from './checkpoints';
import { isSurfaceAuditWorld } from './layout-fixtures';

/**
 * What an opener gets: the page of the role the inventory names, already on
 * the audited route, the world and the run's business date. Openers seed the
 * rows a dialog needs through `surfaceFixture`, never through the golden seed
 * (a measurement digest input).
 */
export type SurfaceContext = {
  page: Page;
  role: SurfaceRole;
  world: TestWorld;
  businessDate: string;
  /** The concrete page the audit opened for the inventoried route. */
  route: string;
};

/**
 * Seeds a row once per world and returns its value (an id or a number) on every
 * later call. `name` is `<area>.<record>`; `create` runs only when the world
 * holds no value under that name yet.
 */
export async function surfaceFixture(
  world: TestWorld,
  name: `${string}.${string}`,
  create: () => Promise<string>,
): Promise<string> {
  if (!isSurfaceAuditWorld(world)) throw new Error('Surface fixtures require their owning audit world.');
  const existing = auditCheckpoint('surface.fixtures')?.[name];
  if (existing) return existing;
  const value = await create();
  saveAuditCheckpoint('surface.fixtures', { ...(auditCheckpoint('surface.fixtures') ?? {}), [name]: value });
  return value;
}
