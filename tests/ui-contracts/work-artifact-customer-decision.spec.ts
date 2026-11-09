import { expect, test, type Locator, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The customer's decision on a customer-facing Arbeitsbericht is one step:
// name, role, decision and signature, then one „Speichern“ that sends the
// decision with its signature in one save. Afterwards the dialog shows what
// was recorded instead of the form, so nobody records it twice. The field
// worker sees no reviewer reason, and the image fallback speaks German
// (werk-flow/werkflow-planning#68).

async function openReport(page: Page, viewer: 'employee' | 'admin' = 'employee'): Promise<Locator> {
  await page.addInitScript((who) => {
    window.uiContractWorkArtifactViewer = who;
  }, viewer);
  await openContractFixture(page, 'work-artifact-customer-decision');
  await page.getByRole('button', { name: /Wartung Heizung/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Wartung Heizung', exact: true });
  await expect(dialog.getByText('Brenner gereinigt und Abgaswerte gemessen.')).toBeVisible();
  return dialog;
}

async function openDecisionForm(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Kundenentscheidung und Unterschrift' }).click();
}

async function chooseDecision(page: Page, dialog: Locator, decision: string): Promise<void> {
  await dialog.getByRole('combobox', { name: 'Entscheidung' }).click();
  await page.getByRole('option', { name: decision, exact: true }).click();
}

async function drawSignature(page: Page, dialog: Locator): Promise<void> {
  const pad = dialog.getByLabel('Unterschrift zeichnen');
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error('The signature pad has no box.');
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 80, { steps: 8 });
  await page.mouse.up();
}

const saveButton = (dialog: Locator) => dialog.getByRole('button', { name: 'Speichern', exact: true });
const decisions = (page: Page) => page.evaluate(() => window.uiContractWorkArtifacts.decisions);

test('the field worker sees no reviewer reason; a save without name and decision marks both', async ({
  page,
}) => {
  const dialog = await openReport(page);
  await expect(dialog.getByRole('textbox', { name: /^Begründung für/ })).toHaveCount(0);
  await openDecisionForm(dialog);
  await expect(dialog.getByRole('button', { name: 'Bestätigung erfassen' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Unterschrift speichern' })).toHaveCount(0);

  await saveButton(dialog).click();

  const name = dialog.getByRole('textbox', { name: 'Name', exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveAccessibleDescription(/Bitte gib den Namen der Kundin oder des Kunden an\./);
  await expect(dialog.getByRole('combobox', { name: 'Entscheidung' })).toHaveAccessibleDescription(
    /Bitte wähle die Entscheidung der Kundin oder des Kunden\./,
  );
  await expect(saveButton(dialog)).toBeEnabled();
  expect(await decisions(page)).toEqual([]);
  // The marks follow the entries: a filled name loses its mark at once.
  await name.fill('Erika Beispiel');
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
});

test('one save records the decision with the drawn signature and shows both in place', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await dialog.getByRole('textbox', { name: 'Rolle/Funktion' }).fill('Objektleitung');
  await chooseDecision(page, dialog, 'Bestätigt');
  await drawSignature(page, dialog);

  await saveButton(dialog).click();

  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Bestätigt');
  await expect(recorded).toContainText('Erika Beispiel · Objektleitung · Ansprechperson vor Ort');
  await expect(recorded.getByRole('img', { name: 'Unterschrift von Erika Beispiel' })).toBeVisible();
  // The form is gone, so the decision cannot be recorded a second time.
  await expect(dialog.getByRole('button', { name: 'Kundenentscheidung und Unterschrift' })).toHaveCount(0);
  await expect(saveButton(dialog)).toHaveCount(0);

  const sent = await decisions(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    decision: 'customer_acknowledged',
    signer: { name: 'Erika Beispiel', role: 'Objektleitung', relationship: 'Ansprechperson vor Ort' },
    signature: { documentId: expect.any(String) },
  });
  expect(sent[0]?.signature?.actionId).not.toBe(sent[0]?.decisionActionId);
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.signatureUploads)).toEqual([
    'Unterschrift.png',
  ]);
});

test('a refusal with an image signature needs the reason, and the image control speaks German', async ({
  page,
}) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  const imageChoice = dialog.getByRole('button', { name: 'Oder Unterschrift als Bild auswählen' });
  await expect(imageChoice).toHaveText('Bild auswählen');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'unterschrift-scan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  });
  await expect(dialog.getByText('unterschrift-scan.png')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Abgelehnt');

  await saveButton(dialog).click();

  const reason = dialog.getByRole('textbox', { name: 'Begründung der Kundin oder des Kunden' });
  await expect(reason).toBeFocused();
  expect(await decisions(page)).toEqual([]);
  await reason.fill('Kundin prüft die Anlage erst selbst.');
  await saveButton(dialog).click();

  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Abgelehnt');
  await expect(recorded).toContainText('Kundin prüft die Anlage erst selbst.');
  expect(await decisions(page)).toMatchObject([
    { decision: 'customer_refused', reason: 'Kundin prüft die Anlage erst selbst.', signature: {} },
  ]);
});

async function chooseSignatureImage(dialog: Locator): Promise<void> {
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'unterschrift-scan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
  });
  await expect(dialog.getByText('unterschrift-scan.png')).toBeVisible();
}

test('a cleared „Bezug zum Kunden“ is marked and focused, and nothing is sent', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  const relationship = dialog.getByRole('textbox', { name: /^Bezug zum Kunden/ });
  await relationship.fill('');
  await chooseDecision(page, dialog, 'Bestätigt');

  await saveButton(dialog).click();

  await expect(relationship).toBeFocused();
  await expect(relationship).toHaveAccessibleDescription(
    /Bitte gib an, in welchem Bezug die Person zum Kunden steht\./,
  );
  expect(await decisions(page)).toEqual([]);
});

test('a chosen signature image survives a tap on the pad and a resize, and is saved', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await chooseSignatureImage(dialog);
  // A tap draws nothing, and a narrower screen resizes the pad: neither drops the image.
  const pad = dialog.getByLabel('Unterschrift zeichnen');
  await pad.scrollIntoViewIfNeeded();
  await pad.click();
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(dialog.getByText('unterschrift-scan.png')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');

  await saveButton(dialog).click();

  await expect(dialog.getByRole('region', { name: 'Kundenentscheidung' })).toContainText('Bestätigt');
  expect(await decisions(page)).toMatchObject([{ signature: { documentId: expect.any(String) } }]);
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.signatureUploads)).toEqual([
    'unterschrift-scan.png',
  ]);
});

test('after a lost answer the entries stay locked through a refused retry, and the replay shows the recorded decision', async ({
  page,
}) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');
  await drawSignature(page, dialog);
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.loseDecisionAnswer = true;
  });

  await saveButton(dialog).click();
  await expect(
    dialog.getByText(
      'Die Antwort zum Speichern ist nicht angekommen. Speichere erneut, um zu prüfen, was erfasst wurde.',
    ),
  ).toBeVisible();
  // The first save may stand, and its replay would not carry edits: the entries stay locked.
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: /^Bezug zum Kunden/ })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: 'Entscheidung' })).toBeDisabled();
  await expect(saveButton(dialog)).toBeEnabled();
  // A refused retry settles nothing: the sign-in check runs before the ids are compared.
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.refuseDecision = 'unauthenticated';
  });
  await saveButton(dialog).click();
  await expect.poll(async () => (await decisions(page)).length).toBe(2);
  await expect(saveButton(dialog)).toBeEnabled();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    delete window.uiContractWorkArtifacts.refuseDecision;
  });
  await saveButton(dialog).click();

  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Bestätigt');
  await expect(
    dialog.getByText('Für diese Version ist bereits eine Kundenentscheidung erfasst.'),
  ).toHaveCount(0);
  const [first, , retry] = await decisions(page);
  expect(retry?.decisionActionId).toBe(first?.decisionActionId);
  expect(retry?.signature?.actionId).toBe(first?.signature?.actionId);
  // The upload from the first attempt is reused, not sent again.
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.signatureUploads)).toEqual([
    'Unterschrift.png',
  ]);
});

test('a decision recorded meanwhile is shown instead, and closing discards the unused signature', async ({
  page,
}) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');
  await drawSignature(page, dialog);
  // A colleague recorded the decision without a signature a moment earlier.
  await page.evaluate(() => {
    const state = window.uiContractWorkArtifacts;
    const detail = state.detail;
    const [action] = detail?.actions ?? [];
    if (!detail || !action) throw new Error('The fixture report is missing.');
    state.detail = {
      ...detail,
      version: detail.version + 1,
      actions: [
        {
          ...action,
          id: 'colleague-decision',
          action_type: 'customer_reserved',
          reason: 'Seriennummer fehlt.',
          signer_name: 'Max Muster',
        },
        ...detail.actions,
      ],
    };
    state.refuseDecision = 'work_artifact_customer_decision_recorded';
  });

  await saveButton(dialog).click();

  await expect(
    dialog.getByText('Für diese Version ist bereits eine Kundenentscheidung erfasst.', { exact: false }),
  ).toBeVisible();
  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Mit Vorbehalt bestätigt');
  await expect(recorded).toContainText('Ohne Unterschrift erfasst');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  const state = await page.evaluate(() => window.uiContractWorkArtifacts);
  expect(state.discards).toHaveLength(1);
  expect(state.discards[0]).toBe(state.decisions[0]?.signature?.documentId);
});

test('a failed signature read offers its retry', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.failSignatureView = true;
  });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');
  await drawSignature(page, dialog);
  await saveButton(dialog).click();

  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Die Unterschrift konnte nicht geladen werden.');
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.failSignatureView = false;
  });
  await recorded.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(recorded.getByRole('img', { name: 'Unterschrift von Erika Beispiel' })).toBeVisible();
});

test('an image that fails to load after its URL read offers a retry with a fresh URL', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.brokenSignatureImage = true;
  });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');
  await drawSignature(page, dialog);
  await saveButton(dialog).click();

  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Die Unterschrift konnte nicht geladen werden.');
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.brokenSignatureImage = false;
  });
  await recorded.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(recorded.getByRole('img', { name: 'Unterschrift von Erika Beispiel' })).toBeVisible();
});

test('a coworker reads that a signature exists without its image or signer', async ({ page }) => {
  // The detail as the server hands it to a coworker: signer and document redacted.
  await page.addInitScript(() => {
    window.uiContractRedactedDecision = true;
  });
  const dialog = await openReport(page);
  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Bestätigt');
  await expect(recorded).toContainText('Unterschrift erfasst');
  await expect(recorded).not.toContainText('Ohne Unterschrift erfasst');
  await expect(recorded.getByRole('img')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Kundenentscheidung und Unterschrift' })).toHaveCount(0);
});

test('a signature saved alone by an earlier release still leaves the decision to record, without a second signature', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractLegacySignature = true;
  });
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await expect(
    dialog.getByText('Die Unterschrift ist schon erfasst. Speichere jetzt die Entscheidung dazu.'),
  ).toBeVisible();
  await expect(dialog.getByLabel('Unterschrift zeichnen')).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');

  await saveButton(dialog).click();

  await expect(dialog.getByRole('region', { name: 'Kundenentscheidung' })).toContainText('Bestätigt');
  const [sent] = await decisions(page);
  expect(sent?.signature).toBeUndefined();
});

test('the signer and reason fields stop at the lengths the server accepts', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  for (const name of ['Name', 'Rolle/Funktion'])
    await expect(dialog.getByRole('textbox', { name, exact: true })).toHaveAttribute('maxlength', '200');
  await expect(dialog.getByRole('textbox', { name: /^Bezug zum Kunden/ })).toHaveAttribute(
    'maxlength',
    '200',
  );
  await chooseDecision(page, dialog, 'Abgelehnt');
  await expect(
    dialog.getByRole('textbox', { name: 'Begründung der Kundin oder des Kunden' }),
  ).toHaveAttribute('maxlength', '2000');
});

test('an error that does not say whether the save stood locks the entries like a lost answer', async ({
  page,
}) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.refuseDecision = 'work_artifact_action_failed';
  });

  await saveButton(dialog).click();

  await expect(
    dialog.getByText(
      'Die Antwort zum Speichern ist nicht angekommen. Speichere erneut, um zu prüfen, was erfasst wurde.',
    ),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
});

test('a save right after the last stroke carries the drawing', async ({ page }) => {
  const dialog = await openReport(page);
  await openDecisionForm(dialog);
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Erika Beispiel');
  await chooseDecision(page, dialog, 'Bestätigt');
  await drawSignature(page, dialog);
  await saveButton(dialog).click();

  await expect(dialog.getByRole('region', { name: 'Kundenentscheidung' })).toContainText('Bestätigt');
  expect(await decisions(page)).toMatchObject([{ signature: { documentId: expect.any(String) } }]);
});

test('a decision and a signature saved apart by two people name each signer', async ({ page }) => {
  await page.addInitScript(() => {
    window.uiContractSplitSigners = true;
  });
  const dialog = await openReport(page, 'admin');
  const recorded = dialog.getByRole('region', { name: 'Kundenentscheidung' });
  await expect(recorded).toContainText('Erika Beispiel');
  await expect(recorded.getByText('Unterschrieben von')).toBeVisible();
  await expect(recorded).toContainText('Max Beispiel');
});

test('an Admin keeps the reason field for voiding', async ({ page }) => {
  const dialog = await openReport(page, 'admin');
  await expect(dialog.getByRole('textbox', { name: 'Begründung für Ungültigkeit' })).toBeVisible();
});
