import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium, type FullConfig } from '@playwright/test';
import { assertWorkspaceTestLock } from "../../lib/testing/workspace-test-lock";

import { loadEnvLocal } from './support/env';
import {
  archiveActiveState,
  attachWorldToRun,
  clearActiveRunState,
  currentRunKey,
  ensureRunManifest,
  markRunFailed,
  restoreArchivedState,
  updateRunManifest,
} from './support/run-state';
import { createTestWorld } from './support/seed';
import { ensureFreshRoleSession, type SessionRole } from './support/sessions';
import { artifactsDirectory, saveWorld, type TestWorld } from './support/world';

const SESSION_ROLES: SessionRole[] = ['admin', 'buero', 'employee', 'outsider'];

function createUploadFixture(): void {
  mkdirSync(artifactsDirectory(), { recursive: true });
  const largePdfPath = resolve(artifactsDirectory(), 'upload-fixture.pdf');
  const sixMegabytes = 6 * 1024 * 1024;
  if (existsSync(largePdfPath) && statSync(largePdfPath).size === sixMegabytes) return;
  const buffer = Buffer.alloc(sixMegabytes, 'WerkFlow golden gate upload fixture. ');
  buffer.write('%PDF-1.4\n', 0);
  writeFileSync(largePdfPath, buffer);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  assertWorkspaceTestLock();
  loadEnvLocal();
  const baseUrl = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  const reuseRunKey = process.env.WERKFLOW_REUSE_RUN_KEY;
  ensureRunManifest();

  let world: TestWorld | null = null;
  try {
    if (reuseRunKey) {
      world = restoreArchivedState(reuseRunKey);
      console.log(`[golden] reusing retained world ${world.runId} from ${reuseRunKey}`);
    } else {
      clearActiveRunState();
      // Orphan cleanup is explicit. Starting a group must never sweep another group's records.
      world = await createTestWorld((planned) => {
        world = planned;
        saveWorld(planned);
        attachWorldToRun(planned);
        archiveActiveState();
      });
      saveWorld(world);
      console.log(`[golden] seeded world ${world.runId} (org ${world.orgId})`);
    }

    attachWorldToRun(world);
    createUploadFixture();
    const browser = await chromium.launch();
    try {
      for (const role of SESSION_ROLES) {
        await ensureFreshRoleSession({ browser, baseUrl, world, role, force: true });
      }
    } finally {
      await browser.close();
    }
    console.log('[golden] all four role sessions refreshed and protected-route checked');
  } catch (error) {
    const failure = {
      title: 'Global setup',
      file: 'tests/golden/global-setup.ts',
      message: error instanceof Error ? error.message : String(error),
    };
    markRunFailed(failure);
    updateRunManifest(currentRunKey(), (current) => ({
      status: world ? 'failed_retained' : 'failed',
      completedAt: new Date().toISOString(),
      failures: [...current.failures, failure],
      retainedAt: world ? new Date().toISOString() : current.retainedAt,
    }));
    if (world) archiveActiveState();
    throw error;
  }
}
