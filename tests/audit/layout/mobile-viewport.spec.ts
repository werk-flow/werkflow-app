import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { expectButtonTextContrast } from "../support/button-contrast";

// Design canon (werkflow-design, "Density and layout"): no page-level
// horizontal scroll on any viewport, and the app shell owns the vertical
// scroll, so the document itself never scrolls (the page header used to slide
// under the app bar on phones). Native form controls stay out of the web app.
// This audit walks every authenticated area at a phone width and fails on the
// first route that breaks either rule. Tag: @AUDIT-LAYOUT.

test.describe.configure({ mode: "serial" });

const PHONE = { width: 375, height: 812 };

const MANAGER_ROUTES = [
  "/dashboard",
  "/aufgaben",
  "/kalender",
  "/zeiterfassung",
  "/zeiterfassung/zeitkonto",
  "/zeiterfassung/perioden",
  "/zeiterfassung/einstellungen",
  "/qualifikationen",
  "/anfragen",
  "/auftraege",
  "/kunden",
  "/mitarbeiter",
  "/arbeitsvorlagen",
  "/dokumente",
  "/inventar",
  "/service/faelle",
  "/service/anlagen",
  "/service/wartung",
  "/einstellungen/profil",
  "/einstellungen/zeiterfassung",
] as const;

const EMPLOYEE_ROUTES = [
  "/dashboard",
  "/aufgaben",
  "/zeiterfassung",
  "/auftraege",
  "/qualifikationen",
] as const;

type ViewportReport = {
  documentOverflowX: number;
  documentOverflowY: number;
  pageBodyOverflowX: number;
  nativeSelects: number;
  nativeDateLikeInputs: number;
  unapprovedVisibleTables: number;
  unapprovedTableScrollRegions: number;
};

async function measure(page: Page): Promise<ViewportReport> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.querySelector<HTMLElement>("[data-page-body]");
    // FullCalendar owns its named, horizontally scrollable calendar grid.
    // Ordinary data tables must switch to cards at this viewport, even when
    // their own overflow container conceals them from document-width checks.
    const visibleTables = Array.from(document.querySelectorAll("table")).filter(
      (table) =>
        table.getClientRects().length > 0 &&
        getComputedStyle(table).visibility !== "hidden" &&
        !table.closest(".fc"),
    );
    const nativeDateTypes = new Set([
      "date",
      "time",
      "datetime-local",
      "month",
      "week",
      "number",
      "range",
    ]);
    return {
      documentOverflowX: Math.max(0, root.scrollWidth - window.innerWidth),
      documentOverflowY: Math.max(0, root.scrollHeight - window.innerHeight),
      pageBodyOverflowX: body
        ? Math.max(0, body.scrollWidth - body.clientWidth)
        : 0,
      nativeSelects: Array.from(document.querySelectorAll("select")).filter(
        (element) => element.getAttribute("aria-hidden") !== "true",
      ).length,
      nativeDateLikeInputs: Array.from(
        document.querySelectorAll("input"),
      ).filter((input) => nativeDateTypes.has(input.type)).length,
      unapprovedVisibleTables: visibleTables.length,
      unapprovedTableScrollRegions: visibleTables.filter((table) => {
        const container = table.parentElement;
        return container && container.scrollWidth > container.clientWidth;
      }).length,
    };
  });
}

async function expectPhoneLayout(page: Page, route: string): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const report = await measure(page);
  expect(
    report,
    `${route}: the document must not scroll sideways`,
  ).toMatchObject({ documentOverflowX: 0 });
  expect(
    report.documentOverflowY,
    `${route}: the shell owns vertical scroll, not the document`,
  ).toBe(0);
  expect(
    report.pageBodyOverflowX,
    `${route}: content wider than the page body`,
  ).toBe(0);
  expect(report.nativeSelects, `${route}: native <select> rendered`).toBe(0);
  expect(
    report.unapprovedTableScrollRegions,
    `${route}: nested table scroll hides mobile overflow`,
  ).toBe(0);
  expect(
    report.unapprovedVisibleTables,
    `${route}: data table has no mobile card layout`,
  ).toBe(0);
  expect(
    report.nativeDateLikeInputs,
    `${route}: native date/time/number input rendered`,
  ).toBe(0);
}

async function expectAreaHeader(page: Page, route: string): Promise<void> {
  const isTimeArea = route.startsWith("/zeiterfassung");
  const isServiceArea = route.startsWith("/service/");
  if (!isTimeArea && !isServiceArea) return;
  const title = isTimeArea ? "Zeiterfassung" : "Service";
  const navigationName = isTimeArea
    ? "Arbeitszeitmanagement"
    : "Servicebereiche";
  const destinations = isTimeArea
    ? [
        "/zeiterfassung",
        "/zeiterfassung/zeitkonto",
        "/zeiterfassung/perioden",
        "/zeiterfassung/einstellungen",
      ]
    : ["/service/faelle", "/service/anlagen", "/service/wartung"];
  const header = page.getByRole("main").locator("[data-page-header]");
  await expect(header).toHaveCount(1);
  await expect(
    header.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const navigation = header.getByRole("navigation", {
    name: navigationName,
    exact: true,
  });
  await expect(navigation).toBeVisible();
  expect(
    await navigation
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  ).toEqual(destinations);
  await expect(navigation.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute(
    "href",
    route,
  );

  // Use client navigation to prove that the layout's real DOM survives a
  // subpage change. A fresh page.goto would only prove its final appearance.
  if (route !== "/zeiterfassung" && route !== "/service/faelle") return;
  const headerNode = await header.elementHandle();
  const navigationNode = await navigation.elementHandle();
  if (!headerNode || !navigationNode)
    throw new Error("Area layout is not mounted.");
  const destination = isTimeArea
    ? "/zeiterfassung/zeitkonto"
    : "/service/anlagen";
  await navigation.locator(`a[href="${destination}"]`).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: isTimeArea ? "Zeitkonto" : "Anlagen & Geräte",
      exact: true,
    }),
  ).toBeVisible();
  await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute(
    "href",
    destination,
  );
  expect(await headerNode.evaluate((node) => node.isConnected)).toBe(true);
  expect(await navigationNode.evaluate((node) => node.isConnected)).toBe(true);
  expect(
    await header.evaluate((node, original) => node === original, headerNode),
  ).toBe(true);
  expect(
    await navigation.evaluate(
      (node, original) => node === original,
      navigationNode,
    ),
  ).toBe(true);
  await expect(
    header.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();
}

async function expectRequestControlsOnPhone(page: Page): Promise<void> {
  const search = page.getByRole("textbox", {
    name: "Anfragen durchsuchen",
    exact: true,
  });
  const refresh = page.getByRole("button", {
    name: "Liste aktualisieren",
    exact: true,
  });
  const tabs = page.getByRole("tablist");
  const searchBox = await search.boundingBox();
  const refreshBox = await refresh.boundingBox();
  const tabsBox = await tabs.boundingBox();
  if (!searchBox || !refreshBox || !tabsBox)
    throw new Error("Request filter strip is not visible.");
  expect(searchBox.width).toBeGreaterThan(150);
  expect(searchBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);
  expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(refreshBox.x);
  await refresh.click();
  await expect(search).not.toBeFocused();
  await expect(refresh).toBeEnabled();

  await page.getByRole("button", { name: "Erfassen", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Neue Anfrage erfassen",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const date = dialog.locator("#request-received-at-date");
  const time = dialog.locator("#request-received-at-time");
  const pair = date.locator("..");
  expect(
    await pair.evaluate((grid) => grid.scrollWidth - grid.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 768, height: PHONE.height });
  await date.scrollIntoViewIfNeeded();
  const wideContainer = await pair.evaluate((grid) => ({
    width: grid.parentElement!.getBoundingClientRect().width,
    threshold:
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) *
      20,
  }));
  expect(wideContainer.width).toBeGreaterThanOrEqual(wideContainer.threshold);
  await expect
    .poll(async () => {
      const dateBox = await date.boundingBox();
      const timeBox = await time.boundingBox();
      return dateBox && timeBox
        ? Math.abs(dateBox.y - timeBox.y)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 320, height: PHONE.height });
  await date.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      pair.evaluate((grid) => {
        const [dateControl, timeControl] = Array.from(grid.children);
        const dateBox = dateControl.getBoundingClientRect();
        const timeBox = timeControl.getBoundingClientRect();
        return timeBox.top - dateBox.bottom;
      }),
    )
    .toBeGreaterThanOrEqual(0);
  const dimensions = await pair.evaluate((grid) => {
    const container = grid.parentElement!;
    const box = container.getBoundingClientRect();
    const controls = Array.from(grid.children).map((control) =>
      control.getBoundingClientRect(),
    );
    return {
      width: box.width,
      threshold:
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize) *
        20,
      overflow: container.scrollWidth - container.clientWidth,
      contained: controls.every(
        (control) =>
          control.left >= box.left - 1 && control.right <= box.right + 1,
      ),
    };
  });
  expect(dimensions.width).toBeLessThan(dimensions.threshold);
  expect(dimensions.overflow).toBeLessThanOrEqual(1);
  expect(dimensions.contained).toBe(true);
  await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize(PHONE);
}

async function expectServiceDialogContracts(
  page: Page,
  route: string,
): Promise<void> {
  const forms =
    route === "/service/faelle"
      ? [
          {
            open: "Servicefall erfassen",
            title: "Servicefall erfassen",
            input: "#service-summary",
            save: "Speichern",
          },
        ]
      : route === "/service/anlagen"
        ? [
            {
              open: "Anlage erfassen",
              title: "Anlage erfassen",
              input: "#equipment-name",
              save: "Speichern",
            },
          ]
        : route === "/service/wartung"
          ? [
              {
                open: "Abdeckung erfassen",
                title: "Operative Abdeckung erfassen",
                input: "#coverage-reference",
                save: "Abdeckung speichern",
              },
              {
                open: "Wartungsplan anlegen",
                title: "Wartungsplan anlegen",
                input: "#maintenance-interval",
                save: "Wartungsplan anlegen",
              },
            ]
          : [];
  for (const form of forms) {
    await page.getByRole("button", { name: form.open, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: form.title, exact: true });
    const input = dialog.locator(form.input);
    await expect(dialog.locator("form")).toHaveCount(1);
    await expect(
      dialog.getByRole("button", { name: form.save, exact: true }),
    ).toBeEnabled();
    await input.press("Enter");
    // Required business context stays empty, so this proves native submit
    // validation without creating a customer, site, equipment or maintenance row.
    await expect(
      dialog.getByText("Bitte wähle einen Kunden.", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Kunde", exact: true }),
    ).toBeFocused();
    if (form.title === "Anlage erfassen") {
      await dialog
        .getByRole("button", {
          name: "Technische Angaben und Kennungen",
          exact: true,
        })
        .click();
      await dialog
        .getByRole("button", {
          name: "Installation, Inbetriebnahme und Gewährleistung",
          exact: true,
        })
        .click();
    }
    const body = dialog.locator('[data-slot="dialog-body"]');
    const heading = dialog.getByRole("heading", {
      name: form.title,
      exact: true,
    });
    const save = dialog.getByRole("button", { name: form.save, exact: true });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    const before = await save.boundingBox();
    expect(before).not.toBeNull();
    expect(
      await body.evaluate(
        (element) => element.scrollHeight > element.clientHeight,
      ),
    ).toBe(true);
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(heading).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    const after = await save.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
    await dialog
      .getByRole("button", { name: "Abbrechen", exact: true })
      .click();
    await expect(dialog).toBeHidden();
  }
}

test.describe("@AUDIT-LAYOUT phone viewport: no horizontal scroll, shell-owned scroll, no native controls", () => {
  for (const route of MANAGER_ROUTES) {
    test(`admin ${route} fits a 375 px viewport`, async ({ adminPage }) => {
      await expectPhoneLayout(adminPage, route);
      if (route === "/service/faelle") {
        await expectButtonTextContrast(adminPage, adminPage.getByRole("main").getByRole("button", {
          name: "Servicefall erfassen", exact: true,
        }));
        await expect(adminPage.getByRole("dialog")).toHaveCount(0);
      }
      await expectServiceDialogContracts(adminPage, route);
      await expectAreaHeader(adminPage, route);
      if (route === "/anfragen") await expectRequestControlsOnPhone(adminPage);
    });
  }

  for (const route of EMPLOYEE_ROUTES) {
    test(`employee ${route} fits a 375 px viewport`, async ({
      employeePage,
    }) => {
      await expectPhoneLayout(employeePage, route);
    });
  }
});
