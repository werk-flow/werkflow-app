import { expect, type Locator, type Page } from "@playwright/test";
import { visibleText } from './shared';

// Uploads into the "Dokumente & Bilder" section of the page currently open.
// Shared by the job-page and request-page upload steps.
export async function uploadIntoDocumentsSection(
  page: Page,
  filePath: string,
  expectedFileName: string,
  options?: { enclosingDialog?: Locator },
): Promise<void> {
  const documentsContainer = options?.enclosingDialog ?? page.getByRole("main");
  const documentsHeading = visibleText(
    documentsContainer,
    "Dokumente & Bilder",
  );
  await expect(documentsHeading).toBeVisible({
    timeout: 30_000,
  });

  const section = documentsContainer
    .getByTestId("contextual-documents-section")
    .filter({ hasText: "Dokumente & Bilder" });
  await expect(section).toHaveCount(1);
  await expect(section).toBeVisible();
  await section.locator('input[type="file"]').first().setInputFiles(filePath);
  const uploadDialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Dateien hochladen" }),
  });

  // Direct-to-R2 upload dialog: the dialog closes itself 650 ms after a fully
  // successful upload, so the completion counter is a transient flash on a
  // fast backend under load (missed once in the Stage B campaign, incident
  // 2026-08-28T184856310Z-a28019). Completion is either the counter or the
  // self-close; a failed upload keeps the dialog open, and the error check
  // plus the persisted file-name assertion below stay strict.
  let uploadDialogSeen = false;
  await expect
    .poll(
      async () => {
        if (await uploadDialog.getByText("1 von 1 abgeschlossen").isVisible()) {
          return "complete";
        }
        const dialogOpen = (await uploadDialog.count()) > 0;
        if (dialogOpen) {
          uploadDialogSeen = true;
          return "uploading";
        }
        return uploadDialogSeen ? "closed" : "starting";
      },
      { timeout: 60_000 },
    )
    .toMatch(/^(complete|closed)$/);
  await expect(page.getByText("Upload fehlgeschlagen.")).toHaveCount(0);

  const closeButton = uploadDialog.getByRole("button", { name: "Schließen" });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click().catch(() => undefined);
  }
  // Dialog must be gone before asserting, so the file name match can only come
  // from the documents section itself, not from the dialog's row list.
  await expect(uploadDialog).toHaveCount(0, { timeout: 10_000 });

  const persistedFile = options?.enclosingDialog
    ? options.enclosingDialog
        .getByText(expectedFileName)
        .filter({ visible: true })
        .first()
    : visibleText(page, expectedFileName);
  await expect(persistedFile).toBeVisible({ timeout: 15_000 });
}

export async function uploadDocumentOnJobPage(
  page: Page,
  jobNumber: string,
  filePath: string,
  expectedFileName: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await uploadIntoDocumentsSection(page, filePath, expectedFileName);
}
