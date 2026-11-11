import { expect, type Locator, type Page } from '@playwright/test';

import { createAdminClient } from '../../golden/support/db/shared';
import { getJobIdByNumber } from '../../golden/support/db/work';
import { workArtifactsSection } from '../../golden/support/spec-helpers/work-artifact-dialog';
import type { TestWorld } from '../../golden/support/world';
import { todayJobNumber } from './offline-today';

// The report drafts a phone keeps without signal
// (components/auftraege/artifacts/device-draft-list.tsx): locators, the
// synthetic photos and the reads of the device store and the server. The spec
// passes data; copy and storage names live here.

/** The IndexedDB database of lib/field-sync/device/draft-store.ts. */
const DRAFT_DATABASE = 'werkflow-drafts';

const DRAFT_COPY = {
  onDevice: 'Entwurf auf dem Gerät',
  savedOnDevice: /Gerade kein Netz\. Der Entwurf ist auf diesem Gerät gespeichert/,
  delete: 'Löschen',
  deleteConfirmation: /^Entwurf „.*“ löschen\?$/,
} as const;

/** A one-pixel PNG the browser can decode: a synthetic photo, no person and no premises. */
const SYNTHETIC_PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Takes one synthetic photo through the dialog's camera input and waits until the device lists it. */
export async function takeSyntheticPhoto(dialog: Locator, position: number): Promise<void> {
  await dialog
    .getByTestId('artifact-photo-input')
    .setInputFiles({ name: `foto-${position}.png`, mimeType: 'image/png', buffer: SYNTHETIC_PHOTO });
  await expect(dialog.getByRole('img', { name: `Foto ${position}`, exact: true })).toBeVisible();
}

/** The banner that says the draft stayed on the device because there is no signal. */
export function savedOnDeviceBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: DRAFT_COPY.savedOnDevice });
}

/** The section's list of drafts on this device. */
export function deviceDrafts(page: Page): Locator {
  return workArtifactsSection(page).getByTestId('device-drafts');
}

/** The row of one draft on the device that shows „Entwurf auf dem Gerät“. */
export function draftOnDevice(page: Page, title: string): Locator {
  return deviceDrafts(page)
    .getByRole('listitem')
    .filter({ hasText: title })
    .filter({ hasText: DRAFT_COPY.onDevice });
}

/** „Löschen“ of one draft on the device. */
export function deviceDraftDeleteButton(page: Page, title: string): Locator {
  return deviceDrafts(page)
    .getByRole('listitem')
    .filter({ hasText: title })
    .getByRole('button', { name: DRAFT_COPY.delete, exact: true });
}

/** The confirmation before a draft leaves the device for good. */
export function deviceDraftDeleteConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: DRAFT_COPY.deleteConfirmation });
}

/** How many drafts the device store holds, whoever they belong to. */
export async function countDraftsOnDevice(page: Page): Promise<number> {
  return page.evaluate(async (name) => {
    const names = (await indexedDB.databases()).map((info) => info.name);
    if (!names.includes(name)) return 0;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction('drafts').objectStore('drafts').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, DRAFT_DATABASE);
}

/** What the server holds of the job's Arbeitsnachweise with this title. */
export async function readAttachedReports(
  world: TestWorld,
  title: string,
): Promise<
  Array<{ status: string; version: number; revisions: number; photos: number; operations: number }>
> {
  const admin = createAdminClient();
  const jobId = await getJobIdByNumber(world.orgId, todayJobNumber(world));
  const { data: revisions } = await admin
    .from('work_artifact_revisions')
    .select('id, artifact_id')
    .eq('organization_id', world.orgId)
    .eq('title', title)
    .throwOnError();
  const artifactIds = [...new Set(revisions.map((revision) => revision.artifact_id))];
  const revisionIds = revisions.map((revision) => revision.id);
  const { data: artifacts } = await admin
    .from('work_artifacts')
    .select('id, status, version')
    .eq('organization_id', world.orgId)
    .eq('job_id', jobId)
    .in('id', artifactIds)
    .throwOnError();
  const { data: links } = await admin
    .from('work_artifact_revision_documents')
    .select('revision_id')
    .eq('organization_id', world.orgId)
    .in('revision_id', revisionIds)
    .throwOnError();
  const { data: operations } = await admin
    .from('work_artifact_draft_operations')
    .select('revision_id')
    .eq('organization_id', world.orgId)
    .in('revision_id', revisionIds)
    .throwOnError();
  return artifacts.map((artifact) => {
    const own = revisions.filter((revision) => revision.artifact_id === artifact.id).map(({ id }) => id);
    return {
      status: artifact.status,
      version: artifact.version,
      revisions: own.length,
      photos: links.filter((link) => own.includes(link.revision_id)).length,
      operations: operations.filter((operation) => own.includes(operation.revision_id)).length,
    };
  });
}
