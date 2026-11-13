import { expect, type Locator, type Page, type Request } from '@playwright/test';

import { createAdminClient } from '../../golden/support/db/shared';
import { getJobIdByNumber } from '../../golden/support/db/work';
import {
  accountMenuButton,
  showOrganizationSwitcher,
  signOutMenuItem,
} from '../../golden/support/steps/organization';
import { confirmed } from '../../golden/support/steps/shared';
import {
  closeWorkArtifactDialog,
  newWorkArtifactButton,
  workArtifactCreateDialog,
  workArtifactField,
  workArtifactsSection,
} from '../../golden/support/spec-helpers/work-artifact-dialog';
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
  sendNow: 'Jetzt senden',
  /** The line of the session-end question that names each unsent report draft. */
  questionDrafts: 'Berichtsentwürfe',
  /** How the question describes a work report with one photo. */
  questionOnePhotoReport: 'Arbeitsbericht · 1 Foto',
  savedOnDevice: /Gerade kein Netz\. Der Entwurf ist auf diesem Gerät gespeichert/,
  photos: 'Fotos',
  delete: 'Löschen',
  deleteConfirmation: /^Entwurf „.*“ löschen\?$/,
} as const;

/** A one-pixel PNG the browser can decode: a synthetic photo, no person and no premises. */
const SYNTHETIC_PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * The button that opens the camera, named by its field's label. It renders once the dialog keeps
 * its draft on the device: text typed before that is stored only if the dialog is still open then.
 */
export function photoButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: DRAFT_COPY.photos, exact: true });
}

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

/** „Jetzt senden“ of one draft in the section's list, by its title. */
export function deviceDraftSendButton(page: Page, title: string): Locator {
  return confirmed(deviceDrafts(page).getByRole('listitem').filter({ hasText: title })).getByRole('button', {
    name: DRAFT_COPY.sendNow,
    exact: true,
  });
}

/**
 * Waits until the session-end question names the draft, a work report with one photo, by its title,
 * and checks that it shows none of the draft's text.
 */
export async function expectDraftNamedInQuestion(
  question: Locator,
  title: string,
  text: string,
): Promise<void> {
  const drafts = question.getByRole('list', { name: DRAFT_COPY.questionDrafts, exact: true });
  await expect(confirmed(drafts.getByRole('listitem').filter({ hasText: title }))).toContainText(
    DRAFT_COPY.questionOnePhotoReport,
  );
  await expect(question).not.toContainText(text);
}

/** Starts a sign-out from the account menu, which on a phone sits in the menu sheet. */
export async function startSignOut(page: Page): Promise<void> {
  await showOrganizationSwitcher(page);
  await accountMenuButton(page).click();
  await signOutMenuItem(page).click();
}

/** The section's list of drafts on this device. */
export function deviceDrafts(page: Page): Locator {
  return workArtifactsSection(page).getByTestId('device-drafts');
}

/** The row of one draft on the device that shows „Entwurf auf dem Gerät“. */
export function draftOnDevice(page: Page, title: string): Locator {
  return confirmed(
    deviceDrafts(page)
      .getByRole('listitem')
      .filter({ hasText: title })
      .filter({ hasText: DRAFT_COPY.onDevice }),
  );
}

/**
 * Leaves one draft with this title on the device: typed into the dialog for a new Arbeitsnachweis
 * and left there. A draft an earlier call left is kept, so a second call adds none.
 */
export async function leaveDraftOnDevice(page: Page, title: string): Promise<void> {
  // The hint a job page reads before it loads any draft code (use-device-drafts.ts).
  const held = await page.evaluate(() =>
    Object.keys(localStorage).some((key) => key.startsWith('werkflow:drafts:')),
  );
  if (!held) {
    await newWorkArtifactButton(page, { exact: true }).click();
    const dialog = workArtifactCreateDialog(page);
    await expect(photoButton(dialog)).toBeVisible();
    await workArtifactField(dialog, 'title').fill(title);
    await closeWorkArtifactDialog(dialog);
  }
  await expect(draftOnDevice(page, title)).toBeVisible();
}

/** „Löschen“ of one draft on the device. */
export function deviceDraftDeleteButton(page: Page, title: string): Locator {
  return confirmed(
    deviceDrafts(page)
      .getByRole('listitem')
      .filter({ hasText: title })
      .getByRole('button', { name: DRAFT_COPY.delete, exact: true }),
  );
}

/** The confirmation before a draft leaves the device for good. */
export function deviceDraftDeleteConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: DRAFT_COPY.deleteConfirmation });
}

/** Waits until the device store holds this many drafts, whoever they belong to. */
export async function expectDraftsOnDevice(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => countDraftsOnPage(page), { message: `The device store holds ${count} draft(s)` })
    .toBe(count);
}

async function countDraftsOnPage(page: Page): Promise<number> {
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

/**
 * Counts the page's script requests started from now on that have not ended yet; earlier ones never
 * count. Only scripts: the page's live reads may stay open, and the code it loads is what an
 * offline open needs.
 */
export function trackRequestsInFlight(page: Page): () => number {
  const inFlight = new Set<Request>();
  page.on('request', (request) => {
    if (request.resourceType() === 'script') inFlight.add(request);
  });
  const ended = (request: Request): void => {
    inFlight.delete(request);
  };
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return () => inFlight.size;
}

/**
 * Waits until the page loaded, had an idle moment, and every script it started meanwhile ended:
 * what the page fetches once idle is on the page, whatever it is.
 */
export async function waitUntilPageIdle(page: Page, inFlight: () => number): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => new Promise<void>((resolve) => requestIdleCallback(() => resolve())));
  await expect.poll(inFlight).toBe(0);
}

/** One Arbeitsnachweis on the server: its state, and how many revisions, photo links and draft operations wrote it. */
type AttachedReport = {
  status: string;
  version: number;
  revisions: number;
  photos: number;
  operations: number;
  /** „Ausgeführte Arbeiten“ of each revision, oldest first. */
  performedWork: Array<string | null>;
};

/** Asserts what the server holds of the job's Arbeitsnachweise with this title. */
export async function expectAttachedReports(
  world: TestWorld,
  title: string,
  expected: readonly AttachedReport[],
): Promise<void> {
  expect(await readAttachedReports(world, title)).toEqual(expected);
}

async function readAttachedReports(world: TestWorld, title: string): Promise<AttachedReport[]> {
  const admin = createAdminClient();
  const jobId = await getJobIdByNumber(world.orgId, todayJobNumber(world));
  const { data: revisions } = await admin
    .from('work_artifact_revisions')
    .select('id, artifact_id, performed_work, revision_number')
    .eq('organization_id', world.orgId)
    .eq('title', title)
    .order('revision_number')
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
    const ownRevisions = revisions.filter((revision) => revision.artifact_id === artifact.id);
    const own = ownRevisions.map(({ id }) => id);
    return {
      status: artifact.status,
      version: artifact.version,
      revisions: own.length,
      photos: links.filter((link) => own.includes(link.revision_id)).length,
      operations: operations.filter((operation) => own.includes(operation.revision_id)).length,
      performedWork: ownRevisions.map((revision) => revision.performed_work),
    };
  });
}
