import type { Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';

// Design canon (werkflow-design, "Density and layout"): no page-level
// horizontal scroll on any viewport, and the app shell owns the vertical
// scroll, so the document itself never scrolls (the page header used to slide
// under the app bar on phones). Native form controls stay out of the web app.
// This audit walks every authenticated area at a phone width and fails on the
// first route that breaks either rule. Tag: @AUDIT-LAYOUT.

test.describe.configure({ mode: 'serial' });

const PHONE = { width: 375, height: 812 };

const MANAGER_ROUTES = [
  '/dashboard',
  '/aufgaben',
  '/kalender',
  '/zeiterfassung',
  '/zeiterfassung/zeitkonto',
  '/zeiterfassung/perioden',
  '/qualifikationen',
  '/anfragen',
  '/auftraege',
  '/kunden',
  '/mitarbeiter',
  '/arbeitsvorlagen',
  '/dokumente',
  '/inventar',
  '/service/faelle',
  '/service/anlagen',
  '/service/wartung',
  '/einstellungen/profil',
  '/einstellungen/zeiterfassung',
] as const;

const EMPLOYEE_ROUTES = ['/dashboard', '/aufgaben', '/zeiterfassung', '/auftraege', '/qualifikationen'] as const;

type ViewportReport = {
  documentOverflowX: number;
  documentOverflowY: number;
  pageBodyOverflowX: number;
  nativeSelects: number;
  nativeDateLikeInputs: number;
};

async function measure(page: Page): Promise<ViewportReport> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.querySelector<HTMLElement>('[data-page-body]');
    const nativeDateTypes = new Set(['date', 'time', 'datetime-local', 'month', 'week', 'number', 'range']);
    return {
      documentOverflowX: Math.max(0, root.scrollWidth - window.innerWidth),
      documentOverflowY: Math.max(0, root.scrollHeight - window.innerHeight),
      pageBodyOverflowX: body ? Math.max(0, body.scrollWidth - body.clientWidth) : 0,
      nativeSelects: Array.from(document.querySelectorAll('select')).filter(
        (element) => element.getAttribute('aria-hidden') !== 'true'
      ).length,
      nativeDateLikeInputs: Array.from(document.querySelectorAll('input')).filter((input) =>
        nativeDateTypes.has(input.type)
      ).length,
    };
  });
}

async function expectPhoneLayout(page: Page, route: string): Promise<void> {
  await page.setViewportSize(PHONE);
  await page.goto(route);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const report = await measure(page);
  expect(report, `${route}: the document must not scroll sideways`).toMatchObject({ documentOverflowX: 0 });
  expect(report.documentOverflowY, `${route}: the shell owns vertical scroll, not the document`).toBe(0);
  expect(report.pageBodyOverflowX, `${route}: content wider than the page body`).toBe(0);
  expect(report.nativeSelects, `${route}: native <select> rendered`).toBe(0);
  expect(report.nativeDateLikeInputs, `${route}: native date/time/number input rendered`).toBe(0);
}

test.describe('@AUDIT-LAYOUT phone viewport: no horizontal scroll, shell-owned scroll, no native controls', () => {
  for (const route of MANAGER_ROUTES) {
    test(`admin ${route} fits a 375 px viewport`, async ({ adminPage }) => {
      await expectPhoneLayout(adminPage, route);
    });
  }

  for (const route of EMPLOYEE_ROUTES) {
    test(`employee ${route} fits a 375 px viewport`, async ({ employeePage }) => {
      await expectPhoneLayout(employeePage, route);
    });
  }
});
