import { appendFileSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";
import { replaceOwnedWorld } from "../../../lib/testing/owned-world-lifecycle";
import { test as sharedTest, expect } from "../../golden/support/fixtures";
import { resetPersistedPreferences } from "../../golden/support/preferences-reset";
import {
  archiveActiveState,
  attachWorldToRun,
  currentRunKey,
  markRunFailed,
  runDirectory,
  updateRunManifest,
} from "../../golden/support/run-state";
import { createTestWorld, destroyTestWorld } from "../../golden/support/seed";
import {
  ensureFreshRoleSession,
  type SessionRole,
} from "../../golden/support/sessions";
import {
  artifactsDirectory,
  loadWorld,
  saveWorld,
  storageStatePath,
  worldFilePath,
} from "../../golden/support/world";

const roles: readonly SessionRole[] = [
  "admin",
  "buero",
  "employee",
  "outsider",
];

// Automatic setup runs before the shared world and role-page fixtures. Files
// run in order internally, but cannot inherit another file's mutations.
export const test = sharedTest.extend<{ auditWorldReady: void }>({
  auditWorldReady: [
    async ({ browser, baseURL }, provide, testInfo) => {
      const group = relative(
        resolve(__dirname, ".."),
        testInfo.file,
      ).replaceAll("\\", "/");
      let world = loadWorld();
      const previousGroup = world.auditGroup;
      const startedAt = performance.now();
      let status: "ready" | "failed" = "failed";
      if (process.env.WERKFLOW_REUSE_RUN_KEY && world.auditGroup !== group) {
        throw new Error(
          `Retained audit world belongs to ${world.auditGroup ?? "a legacy shared run"}, not ${group}. Select only its recorded audit group.`,
        );
      }
      try {
        if (world.auditGroup && world.auditGroup !== group) {
          world = await replaceOwnedWorld({
            previous: world,
            destroy: destroyTestWorld,
            retired: (previousWorld) => {
              updateRunManifest(currentRunKey(), (manifest) => ({
                world: null,
                auditGroup: group,
                retainedAt: null,
                cleanedAt: null,
                completedAuditGroups: [
                  ...(manifest.completedAuditGroups ?? []),
                  {
                    group: previousWorld.auditGroup!,
                    runId: previousWorld.runId,
                    organizationIds: [
                      previousWorld.orgId,
                      previousWorld.outsider.orgId,
                    ],
                    cleanedAt: new Date().toISOString(),
                  },
                ],
              }));
              for (const path of [
                worldFilePath(),
                resolve(artifactsDirectory(), "checkpoints.json"),
                ...roles.map((role) => storageStatePath(role)),
              ]) {
                rmSync(path, { force: true });
              }
            },
            create: () => createTestWorld((planned) => {
              planned.auditGroup = group;
              saveWorld(planned);
              attachWorldToRun(planned);
              archiveActiveState();
            }),
            persist: (replacement) => {
              replacement.auditGroup = group;
              saveWorld(replacement);
              attachWorldToRun(replacement);
            },
            initialize: async (replacement) => {
              for (const role of roles) {
                await ensureFreshRoleSession({
                  browser,
                  baseUrl: baseURL ?? "http://localhost:3000",
                  world: replacement,
                  role,
                  force: true,
                });
              }
            },
          });
        } else if (!world.auditGroup) {
          world.auditGroup = group;
          saveWorld(world);
        }
        updateRunManifest(currentRunKey(), { auditGroup: group });
        status = "ready";
      } catch (error) {
        updateRunManifest(currentRunKey(), (manifest) => ({
          status: manifest.world ? "failed_retained" : "failed",
          retainedAt: manifest.world ? new Date().toISOString() : null,
        }));
        markRunFailed({
          title: `Audit world setup: ${group}`,
          file: testInfo.file,
          message: error instanceof Error ? error.message : String(error),
        });
        archiveActiveState();
        throw error;
      } finally {
        if (previousGroup !== group) {
          appendFileSync(
            resolve(
              runDirectory(currentRunKey()),
              "audit-world-lifecycle.ndjson",
            ),
            `${JSON.stringify({
              group,
              previousGroup: previousGroup ?? null,
              status,
              measuredMs: performance.now() - startedAt,
              boundary: previousGroup
                ? "retire-create-authenticate"
                : "assign-global-setup-world",
              recordedAt: new Date().toISOString(),
            })}\n`,
          );
        }
      }
      await provide();
    },
    { auto: true },
  ],
  // The reset runs after the audit world is settled, so it clears the world the test will use; the
  // inherited fixture stays automatic.
  freshPreferences: async ({ auditWorldReady }, provide) => {
    void auditWorldReady;
    const world = loadWorld();
    await resetPersistedPreferences([world.orgId, world.outsider.orgId]);
    await provide();
  },
});

export { expect };
