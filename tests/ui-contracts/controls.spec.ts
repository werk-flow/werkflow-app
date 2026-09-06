import { expect, test, type Page } from "@playwright/test";
import { assertWorkspaceTestLock } from "@/lib/testing/workspace-test-lock";

const pageErrors = new WeakMap<Page, string[]>();

test("personnel receipt confirms the accepted version without removing access to the document", {
  annotation: { type: "fixture", description: "own-personnel" },
}, async ({ page }) => {
  await page.getByRole("button", { name: "Erhalt bestätigen" }).click();
  await expect(page.getByRole("alert")).toContainText("Der Erhalt der Dokumentversion wurde bestätigt.");
  await expect(page.getByRole("button", { name: "Öffnen", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractPersonnel.acknowledgements)).toBe(1);
});

test("rejected personnel receipt reports failure without a success confirmation", {
  annotation: { type: "fixture", description: "own-personnel" },
}, async ({ page }) => {
  await page.evaluate(() => { window.uiContractPersonnel.rejectAcknowledgement = true; });
  await page.getByRole("button", { name: "Erhalt bestätigen" }).click();
  await expect(page.getByRole("alert")).toHaveText("Die Empfangsbestätigung konnte nicht gespeichert werden.");
  await expect(page.getByRole("button", { name: "Erhalt bestätigen" })).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractPersonnel.acknowledgements)).toBe(0);
});

test("own evidence upload shows its rejection inside the filled dialog and confirms an explicit successful retry", {
  annotation: { type: "fixture", description: "own-personnel" },
}, async ({ page }) => {
  await page.evaluate(() => { window.uiContractPersonnel.rejectUpload = true; });
  await page.getByRole("button", { name: "Nachweis hochladen" }).click();
  const dialog = page.getByRole("dialog", { name: "Gesundheitsnachweis hochladen" });
  await dialog.getByLabel("Datei").setInputFiles({ name: "nachweis.txt", mimeType: "text/plain", buffer: Buffer.from("Contract evidence") });
  await dialog.getByRole("button", { name: "Hochladen", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Der Nachweis konnte nicht hochgeladen werden.");
  await expect(dialog.getByLabel("Dokumentart")).toHaveValue("Krankheitsnachweis");
  expect(await page.evaluate(() => window.uiContractPersonnel.uploads)).toBe(0);
  await page.evaluate(() => { window.uiContractPersonnel.rejectUpload = false; });
  await dialog.getByRole("button", { name: "Hochladen", exact: true }).press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Der Gesundheitsnachweis wurde hochgeladen.");
  expect(await page.evaluate(() => window.uiContractPersonnel.uploads)).toBe(1);
});

test.beforeEach(async ({ page }, testInfo) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error("Run through bun tests/ui-contracts/run.ts.");
  // Deliberately no product styles: this suite proves browser semantics and
  // focus behavior; the real app viewport suite owns layout and theme evidence.
  // A fulfilled localhost document gives real secure-context browser APIs
  // (including crypto.randomUUID) without starting or contacting a server.
  const fixtureUrl = "http://localhost/ui-contracts";
  await page.route(fixtureUrl, async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    });
  });
  await page.goto(fixtureUrl);
  expect(
    await page.evaluate(
      () => window.isSecureContext && typeof crypto.randomUUID === "function",
    ),
  ).toBe(true);
  const fixture =
    testInfo.annotations.find((annotation) => annotation.type === "fixture")
      ?.description ?? "default";
  await page.evaluate((selection) => {
    if (
      selection !== "default" &&
      selection !== "lifecycle" &&
      selection !== "personnel" &&
      selection !== "own-personnel"
    )
      throw new Error(`Unknown UI contract fixture: ${selection}`);
    window.uiContractFixture = selection;
  }, fixture);
  await page.addScriptTag({ path: bundle });
  await expect(
    page.getByRole("heading", { name: "Komponentenverträge" }),
  ).toBeVisible();
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

test(
  "office lifecycle success reconciles owning route metadata without Realtime or an action RSC patch",
  { annotation: { type: "fixture", description: "lifecycle" } },
  async ({ page }) => {
    const section = page.getByRole("region", {
      name: "Arbeitsstand und Auftragsdetails",
    });
    const metadata = section.getByRole("status", { name: "Auftragsstatus" });
    await expect(metadata).toHaveText("Nicht bearbeitet");
    await section
      .getByRole("button", { name: "In Ausführung", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "In Ausführung",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Änderung speichern" }).click();
    await expect(dialog).toHaveCount(0);
    // The real card refreshes its snapshot independently of route metadata.
    await expect(
      section.getByRole("button", {
        name: "Ausführung abgeschlossen",
        exact: true,
      }),
    ).toBeVisible();
    await expect(metadata).toHaveText("In Bearbeitung");
    expect(
      await page.evaluate(() => window.uiContractLifecycle.transitions),
    ).toBe(1);
    const reconciliation = await page.evaluate(
      () => window.uiContractServices.navigation,
    );
    expect(reconciliation.indexOf("refresh")).toBeGreaterThanOrEqual(0);
    expect(reconciliation.indexOf("read-work-lifecycle")).toBeGreaterThan(
      reconciliation.indexOf("refresh"),
    );
  },
);

test(
  "a rejected lifecycle mutation leaves owning metadata untouched and reports the failure",
  { annotation: { type: "fixture", description: "lifecycle" } },
  async ({ page }) => {
    await page.evaluate(() => {
      window.uiContractLifecycle.rejectTransition = true;
    });
    const section = page.getByRole("region", {
      name: "Arbeitsstand und Auftragsdetails",
      includeHidden: true,
    });
    await section
      .getByRole("button", { name: "In Ausführung", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "In Ausführung",
      exact: true,
    });
    const save = dialog.getByRole("button", { name: "Änderung speichern" });
    await save.click();
    await expect(dialog.getByRole("alert")).toContainText("keine Berechtigung");
    await expect(save).toBeEnabled();
    expect(
      await page.evaluate(() => window.uiContractServices.navigation),
    ).toEqual([]);
    expect(
      await page.evaluate(() => window.uiContractLifecycle.transitions),
    ).toBe(0);
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(
      section.getByRole("status", { name: "Auftragsstatus" }),
    ).toHaveText("Nicht bearbeitet");
  },
);

test("nested location Enter saves only the child and preserves the parent draft", async ({
  page,
}) => {
  const section = page.getByRole("region", {
    name: "Verschachtelte Lagererstellung",
    includeHidden: true,
  });
  await section.getByRole("combobox", { name: "Lager", exact: true }).click();
  await page
    .getByRole("button", { name: "Neues Lager erstellen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Lager erstellen",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Werkstatt");
  await dialog
    .getByRole("textbox", { name: "Name", exact: true })
    .press("Enter");
  await expect(dialog).toBeHidden();
  await expect(
    section.getByRole("status", { name: "Artikel gespeichert" }),
  ).toHaveText("0");
  await expect(
    section.getByRole("status", { name: "Übernommenes Lager" }),
  ).toHaveText("contract-location");
  await expect(
    section.getByRole("textbox", { name: "Artikelbezeichnung" }),
  ).toHaveValue("Ventil");
  expect(
    await page.evaluate(() => window.uiContractServices.createdLocations),
  ).toEqual(["Werkstatt"]);
  await section
    .getByRole("textbox", { name: "Artikelbezeichnung" })
    .press("Enter");
  await expect(
    section.getByRole("status", { name: "Artikel gespeichert" }),
  ).toHaveText("1");
});

test("dropdown positions immediately, survives parent updates and restores keyboard focus", async ({
  page,
}) => {
  // The modal portal hides its sibling region from the accessibility tree while open.
  const section = page.getByRole("region", {
    name: "Dropdown-Menü",
    includeHidden: true,
  });
  const trigger = section.getByRole("button", {
    name: "Projektaktionen testen",
  });
  const menu = page.getByRole("menu");
  const refresh = menu.getByRole("menuitem", { name: "Ansicht aktualisieren" });
  const apply = menu.getByRole("menuitem", { name: "Markierung übernehmen" });

  await trigger.click();
  await expect(menu).toBeInViewport({ timeout: 3_000 });
  await expect(refresh).toBeInViewport({ timeout: 3_000 });
  await refresh.click();
  await expect(
    section.locator('output[aria-label="Ansichtsrevision"]'),
  ).toHaveText("1");
  await expect(menu).toBeInViewport({ timeout: 3_000 });
  await expect(apply).toBeInViewport({ timeout: 3_000 });
  await apply.click();
  await expect(menu).toBeHidden();
  await expect(
    section.getByRole("status", { name: "Menüergebnis" }),
  ).toHaveText("Übernommen");
  await expect(trigger).toBeFocused();

  await trigger.press("ArrowDown");
  await expect(menu).toBeInViewport({ timeout: 3_000 });
  await expect(refresh).toBeFocused();
  await page.keyboard.press("End");
  await expect(apply).toBeFocused();
  await expect(apply).toBeInViewport({ timeout: 3_000 });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

for (const failure of ["returned", "thrown"] as const) {
  test(`payment ${failure} failure stays visible and permits retry`, async ({
    page,
  }) => {
    await page.evaluate((mode) => {
      window.uiContractServices.paymentFailure = mode;
    }, failure);
    const section = page.getByRole("region", { name: "Zahlung", exact: true });
    const button = section.getByRole("button", {
      name: "Zahlung simulieren / Fortfahren",
    });
    await button.click();
    await expect(section.getByRole("alert")).toBeVisible();
    await expect(button).toBeEnabled();
    expect(
      await page.evaluate(() => window.uiContractServices.navigation),
    ).toEqual([]);
  });

  for (const [region, name] of [
    ["Abmeldung", "Sitzung beenden"],
    ["Einladungswechsel", "Abmelden & anmelden"],
  ] as const) {
    test(`${region} ${failure} auth failure stays visible without navigating`, async ({
      page,
    }) => {
      await page.evaluate((mode) => {
        window.uiContractServices.authFailure = mode;
      }, failure);
      const priorUrl = page.url();
      const button = page
        .getByRole("region", { name: region, exact: true })
        .getByRole("button", { name, exact: true });
      const failureAlert = page
        .getByRole("alert")
        .filter({ hasText: "Die Abmeldung konnte nicht" });
      await expect(failureAlert).toHaveCount(0);
      await button.click();
      await expect(failureAlert).toBeVisible();
      await expect(button).toBeEnabled();
      expect(page.url()).toBe(priorUrl);
      expect(
        await page.evaluate(() => window.uiContractServices.navigation),
      ).toEqual([]);
      expect(
        await page.evaluate(() => window.uiContractServices.callbackCalls),
      ).toBe(0);
    });
  }
}

test("a failed session callback reports failure and permits retry without navigation", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.uiContractServices.authFailure = "none";
    window.uiContractServices.callbackFailure = true;
  });
  const button = page.getByRole("button", {
    name: "Sitzung beenden",
    exact: true,
  });
  const failureAlert = page
    .getByRole("alert")
    .filter({ hasText: "Die Abmeldung konnte nicht" });
  await expect(failureAlert).toHaveCount(0);
  await button.click();
  await expect(failureAlert).toBeVisible();
  await expect(button).toBeEnabled();
  expect(
    await page.evaluate(() => window.uiContractServices.navigation),
  ).toEqual([]);
  expect(
    await page.evaluate(() => window.uiContractServices.callbackCalls),
  ).toBe(1);
});

test("single choice supports keyboard filtering, selection, none and focus restoration", async ({
  page,
}) => {
  const section = page.getByRole("region", {
    name: "Einzelauswahl",
    exact: true,
  });
  const trigger = section.getByRole("combobox", {
    name: "Verantwortliche Person",
  });
  await expect(trigger).not.toHaveAttribute("aria-controls");
  await trigger.focus();
  await trigger.press("ArrowDown");
  const search = page.getByRole("textbox", {
    name: "Person suchen",
    exact: true,
  });
  await expect(search).toBeFocused();
  await search.fill("Bernd");
  const list = page.getByRole("listbox", { name: "Verantwortliche Person" });
  await expect(trigger).toHaveAttribute(
    "aria-controls",
    (await list.getAttribute("id")) as string,
  );
  await expect(list.getByRole("option")).toHaveCount(2);
  await search.press("ArrowDown");
  await expect(
    list.getByRole("option", { name: "Keine Auswahl" }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    list.getByRole("option", { name: "Bernd Schmidt" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(trigger).not.toHaveAttribute("aria-controls");
  await expect(
    section.getByRole("status", { name: "Gewählte Person" }),
  ).toHaveText("bernd");
  await trigger.click();
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    section.getByRole("status", { name: "Gewählte Person" }),
  ).toHaveText("Keine");
});

test("empty search and clear have accessible names; inline create remains keyboard reachable", async ({
  page,
}) => {
  const section = page.getByRole("region", {
    name: "Einzelauswahl",
    exact: true,
  });
  await section.getByRole("combobox").click();
  const search = page.getByRole("textbox", {
    name: "Person suchen",
    exact: true,
  });
  await search.fill("Kein Treffer");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(1);
  await search.press("Tab");
  await expect(
    page.getByRole("button", { name: "Suche leeren" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await search.press("Tab");
  await expect(
    page.getByRole("button", { name: "Person anlegen" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    section.getByRole("status", { name: "Person angelegt" }),
  ).toHaveText("Ja");
});

test("multi choice announces selected options and supports Space, arrows, Home and clear", async ({
  page,
}) => {
  const section = page.getByRole("region", {
    name: "Mehrfachauswahl",
    exact: true,
  });
  const trigger = section.getByRole("combobox", { name: "Team", exact: true });
  await expect(trigger).not.toHaveAttribute("aria-controls");
  await trigger.click();
  const search = page.getByRole("textbox", { name: "Team durchsuchen" });
  const list = page.getByRole("listbox", { name: "Team", exact: true });
  await expect(trigger).toHaveAttribute(
    "aria-controls",
    (await list.getAttribute("id")) as string,
  );
  await expect(list).toHaveAttribute("aria-multiselectable", "true");
  await search.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(
    list.getByRole("option", { name: "Anna Müller" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(
    list.getByRole("option", { name: "Bernd Schmidt" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(list.getByRole("option", { name: "Anna Müller" })).toBeFocused();
  await page
    .getByRole("button", { name: "Auswahl leeren", exact: true })
    .click();
  await expect(
    section.getByRole("status", { name: "Gewähltes Team" }),
  ).toHaveText("Keine");
  await search.focus();
  await search.press("Tab");
  await expect(
    section.getByRole("button", { name: "Nach der Mehrfachauswahl" }),
  ).toBeFocused();
});

test("real custom controls keep the owning field names and error descriptions", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "Feldeingabe" });
  for (const [name, id] of [
    ["Einsatzdatum", "date"],
    ["Einsatzbeginn", "time"],
  ] as const) {
    const control = section.getByRole("group", { name, exact: true });
    await expect(control).toHaveAttribute(
      "aria-describedby",
      `${id}-error ${id}-description ${id}-required`,
    );
    await expect(control).toHaveAttribute("data-invalid", "true");
    await section.locator(`label[for="${id}"]`).click();
    await expect(control).toBeFocused();
  }
  const duration = section.getByRole("textbox", { name: "Geplante Dauer" });
  await expect(duration).toHaveAttribute("aria-required", "true");
  await expect(duration).toHaveAttribute("aria-invalid", "true");
  await expect(duration).toHaveAttribute(
    "aria-describedby",
    "duration-error duration-description",
  );
});

test("row action selection restores its trigger without stealing a newly opened dialog focus", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "Zeilenaktionen" });
  const trigger = section.getByRole("button", { name: "Aktionen öffnen" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Markieren" }).click();
  await expect(trigger).toBeFocused();
  await expect(
    section.getByRole("status", { name: "Aktionsergebnis" }),
  ).toHaveText("Markiert");
  await trigger.click();
  await page.getByRole("menuitem", { name: "Bearbeiten" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Eintrag bearbeiten" })
      .getByRole("textbox", { name: "Bezeichnung" }),
  ).toBeFocused();
});

test("Tab and ShiftTab leave a row menu at the adjacent page control", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "Zeilenaktionen" });
  const trigger = section.getByRole("button", { name: "Aktionen öffnen" });
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Markieren" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    section.getByRole("button", { name: "Nach den Aktionen" }),
  ).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Markieren" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    section.getByRole("button", { name: "Vor den Aktionen" }),
  ).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("a lost authoritative refresh ends pending with a visible failure", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "Aktualisierung" });
  await section
    .getByRole("button", { name: "Auf Aktualisierung warten" })
    .click();
  await expect(
    section.getByRole("status", { name: "Aktualisierungsstatus" }),
  ).toHaveText("Beendet");
  await expect(
    page.getByRole("alert").filter({ hasText: "aktualisiert" }),
  ).toBeVisible();
});

test("authoritative props settle without reporting a refresh failure", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "Aktualisierung" });
  await section
    .getByRole("button", { name: "Aktualisierung mit Serverantwort" })
    .click();
  await expect(
    section.getByRole("status", { name: "Aktualisierungsstatus" }),
  ).toHaveText("Beendet");
  await expect(
    page.getByRole("alert").filter({ hasText: "aktualisiert" }),
  ).toHaveCount(0);
});

test("unmount cancels an outstanding refresh without a failure banner", async ({
  page,
}) => {
  const section = page.getByRole("region", { name: "Aktualisierung" });
  await section
    .getByRole("button", { name: "Mit offener Aktualisierung entfernen" })
    .click();
  await expect(
    section.getByRole("status", { name: "Ansicht vorhanden" }),
  ).toHaveText("Nein");
  await expect(
    section.getByRole("status", { name: "Warten abgebrochen" }),
  ).toHaveText("Ja");
  await expect(
    page.getByRole("alert").filter({ hasText: "aktualisiert" }),
  ).toHaveCount(0);
});

async function uploadPersonnelContractFile(page: Page): Promise<void> {
  const section = page.getByRole("main").getByTestId("personnel-lifecycle");
  await section.getByRole("button", { name: "Datei", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Geschützte Personalunterlage",
    exact: true,
  });
  await dialog.getByLabel("Datei").setInputFiles({
    name: "willkommen-contract.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Protected contract fixture"),
  });
  await dialog
    .getByRole("textbox", { name: "Dokumentart", exact: true })
    .fill("Willkommensunterlage");
  await dialog.getByRole("button", { name: "Hochladen", exact: true }).click();
}

test(
  "personnel upload reads its saved document despite unchanged route props and no Realtime",
  {
    annotation: { type: "fixture", description: "personnel" },
  },
  async ({ page }) => {
    await uploadPersonnelContractFile(page);
    await expect(
      page.getByRole("dialog", {
        name: "Geschützte Personalunterlage",
        exact: true,
      }),
    ).toHaveCount(0);
    const section = page.getByRole("main").getByTestId("personnel-lifecycle");
    await expect(
      section.getByText("willkommen-contract.txt", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.uiContractPersonnel.uploads)).toBe(
      1,
    );
    expect(
      await page.evaluate(() => window.uiContractPersonnel.reads),
    ).toBeGreaterThan(0);
  },
);

test(
  "personnel upload distinguishes a failed reconciliation from accepted persistence and retries the read",
  {
    annotation: { type: "fixture", description: "personnel" },
  },
  async ({ page }) => {
    await page.evaluate(() => {
      window.uiContractPersonnel.rejectRead = true;
    });
    await uploadPersonnelContractFile(page);
    await expect(
      page.getByRole("dialog", {
        name: "Geschützte Personalunterlage",
        exact: true,
      }),
    ).toHaveCount(0);
    const section = page.getByRole("main").getByTestId("personnel-lifecycle");
    await expect(section.getByRole("alert")).toContainText(
      "konnte nicht aktualisiert werden",
    );
    await expect(
      section.getByRole("button", { name: "Datei", exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => window.uiContractPersonnel.uploads)).toBe(
      1,
    );
    await page.evaluate(() => {
      window.uiContractPersonnel.rejectRead = false;
    });
    await section
      .getByRole("button", { name: "Erneut laden", exact: true })
      .click();
    await expect(
      section.getByText("willkommen-contract.txt", { exact: true }),
    ).toBeVisible();
    await expect(section.getByRole("alert")).toHaveCount(0);
    await expect(
      section.getByRole("button", { name: "Datei", exact: true }),
    ).toBeEnabled();
    expect(await page.evaluate(() => window.uiContractPersonnel.uploads)).toBe(
      1,
    );
  },
);

test(
  "personnel upload rejection keeps the dialog open without a successful save or reconciliation read",
  {
    annotation: { type: "fixture", description: "personnel" },
  },
  async ({ page }) => {
    await page.evaluate(() => {
      window.uiContractPersonnel.rejectUpload = true;
    });
    await uploadPersonnelContractFile(page);
    const dialog = page.getByRole("dialog", {
      name: "Geschützte Personalunterlage",
      exact: true,
    });
    await expect(dialog.getByRole("alert")).toHaveText(
      "Du darfst diese Aktion nicht ausführen.",
    );
    await expect(
      dialog.getByRole("button", { name: "Hochladen", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => ({
        uploads: window.uiContractPersonnel.uploads,
        reads: window.uiContractPersonnel.reads,
      })),
    ).toEqual({ uploads: 0, reads: 0 });
  },
);

test(
  "personnel upload settlement shows progress without blocking an unrelated dialog",
  { annotation: { type: "fixture", description: "personnel" } },
  async ({ page }) => {
    await page.evaluate(() => {
      window.uiContractPersonnel.holdRead = true;
    });
    await uploadPersonnelContractFile(page);
    await expect(
      page.getByRole("dialog", {
        name: "Geschützte Personalunterlage",
        exact: true,
      }),
    ).toHaveCount(0);
    const section = page.getByRole("main").getByTestId("personnel-lifecycle");
    await expect(
      section.getByRole("status", {
        name: "Personalprozess wird aktualisiert",
        exact: true,
      }),
    ).toBeVisible();
    const access = section.getByRole("button", {
      name: "Zugang steuern",
      exact: true,
    });
    await expect(access).toBeEnabled();
    await access.click();
    const dialog = page.getByRole("dialog", {
      name: "Organisationszugang steuern",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      const release = window.uiContractPersonnel.releaseRead;
      if (!release)
        throw new Error("The authoritative personnel read was not held.");
      release();
    });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    await expect(
      section.getByText("willkommen-contract.txt", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByRole("status", {
        name: "Personalprozess wird aktualisiert",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        uploads: window.uiContractPersonnel.uploads,
        reads: window.uiContractPersonnel.reads,
      })),
    ).toEqual({ uploads: 1, reads: 1 });
  },
);
