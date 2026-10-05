import type { Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { CALENDAR_PAGE_TITLE } from '../../golden/support/plantafel';
import { DOCUMENT_LIBRARY_TITLE } from '../../golden/support/steps/documents';
import { loginSubmitButton } from '../../golden/support/steps/organization';
import { SERVICE_AREA_HEADER } from '../../golden/support/steps/service';
import { TIME_AREA_HEADER } from '../../golden/support/steps/time-tracking';
import { DESKTOP, PHONE, expectReference, settlePage } from '../support/visual-references';
import {
  VISUAL_NAMES,
  prepareVisualWorld,
  visualReplacements,
  type VisualDetails,
} from '../support/visual-fixtures';

// Visual references (release mode only): one reference per page family, so a
// change that alters how an accepted screen looks fails until the owner accepts
// the new picture. Each family renders its desktop and phone light references,
// and the dark one where dark mode changes more than the token values of a
// neighbouring family. docs/technical/standards-audit.md owns the acceptance
// and update rules. Tag: @AUDIT-VISUAL.

type Family = {
  /** Reference file prefix. */
  id: string;
  route: (details: VisualDetails) => string;
  /** The page's level-one heading, so an error page never becomes a reference. */
  heading: string;
  /** The record's own heading below an area heading. */
  title?: string;
  dark?: boolean;
  /** False where the route pins its own date, so its date text is already constant. */
  clockText?: boolean;
};

// A fixed week before any seeded record keeps the calendar independent of the run day.
const CALENDAR_WEEK = '2026-03-09';

const MANAGER_FAMILIES: readonly Family[] = [
  { id: 'dashboard', route: () => '/dashboard', heading: 'Dashboard', dark: true },
  { id: 'aufgaben', route: () => '/aufgaben', heading: 'Aufgaben' },
  { id: 'auftraege', route: () => '/auftraege', heading: 'Aufträge', dark: true },
  {
    id: 'auftrag',
    route: () => `/auftraege/${VISUAL_NAMES.jobNumber}`,
    heading: VISUAL_NAMES.job,
    dark: true,
  },
  {
    id: 'projekt',
    route: () => `/auftraege/projekt/${VISUAL_NAMES.projectNumber}`,
    heading: VISUAL_NAMES.project,
  },
  { id: 'kunden', route: () => '/kunden', heading: 'Kunden' },
  { id: 'kunde', route: (details) => `/kunden/${details.familyClientId}`, heading: VISUAL_NAMES.family },
  { id: 'anfragen', route: () => '/anfragen', heading: 'Anfragen' },
  { id: 'anfrage', route: (details) => `/anfragen/${details.requestId}`, heading: VISUAL_NAMES.request },
  { id: 'dokumente', route: () => '/dokumente', heading: DOCUMENT_LIBRARY_TITLE },
  { id: 'inventar', route: () => '/inventar', heading: 'Inventar' },
  { id: 'qualifikationen', route: () => '/qualifikationen', heading: 'Qualifikationen' },
  { id: 'arbeitsvorlagen', route: () => '/arbeitsvorlagen', heading: 'Arbeitsvorlagen' },
  { id: 'mitarbeiter', route: () => '/mitarbeiter', heading: 'Mitarbeiter' },
  { id: 'service-faelle', route: () => '/service/faelle', heading: SERVICE_AREA_HEADER.title },
  {
    id: 'service-fall',
    route: (details) => `/service/faelle/${details.caseNumber}`,
    heading: SERVICE_AREA_HEADER.title,
    title: VISUAL_NAMES.serviceCase,
  },
  { id: 'service-anlagen', route: () => '/service/anlagen', heading: SERVICE_AREA_HEADER.title },
  {
    id: 'service-anlage',
    route: (details) => `/service/anlagen/${details.equipmentNumber}`,
    heading: SERVICE_AREA_HEADER.title,
    title: VISUAL_NAMES.equipment,
  },
  { id: 'service-wartung', route: () => '/service/wartung', heading: SERVICE_AREA_HEADER.title },
  { id: 'zeiterfassung', route: () => '/zeiterfassung', heading: TIME_AREA_HEADER.title },
  { id: 'zeitkonto', route: () => '/zeiterfassung/zeitkonto', heading: TIME_AREA_HEADER.title },
  { id: 'perioden', route: () => '/zeiterfassung/perioden', heading: TIME_AREA_HEADER.title },
  { id: 'einstellungen-profil', route: () => '/einstellungen/profil', heading: 'Einstellungen', dark: true },
  { id: 'einstellungen-organisation', route: () => '/einstellungen/organisation', heading: 'Einstellungen' },
  {
    id: 'kalender',
    route: () => `/kalender?date=${CALENDAR_WEEK}`,
    heading: CALENDAR_PAGE_TITLE,
    dark: true,
    clockText: false,
  },
];

// The field worker's own view: the lowest bar for clarity, so it has its own references.
const FIELD_FAMILIES: readonly Family[] = [
  { id: 'handwerker-dashboard', route: () => '/dashboard', heading: 'Dashboard' },
  {
    id: 'handwerker-auftrag',
    route: () => `/auftraege/${VISUAL_NAMES.jobNumber}`,
    heading: VISUAL_NAMES.job,
  },
];

async function expectFamilyReferences(
  page: Page,
  family: Family,
  route: string,
  replacements: readonly (readonly [string, string])[],
): Promise<void> {
  const open = async (viewport: { width: number; height: number }): Promise<void> => {
    await page.setViewportSize(viewport);
    await page.goto(route);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: family.heading, exact: true })).toBeVisible();
    if (family.title)
      await expect(main.getByRole('heading', { level: 2, name: family.title, exact: true })).toBeVisible();
    await settlePage(page, main.locator('[data-page-body]'));
  };
  const options = { clockText: family.clockText ?? true };
  await page.emulateMedia({ colorScheme: 'light' });
  await open(DESKTOP);
  await expectReference(page, `${family.id}-desktop-light`, replacements, options);
  if (family.dark) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectReference(page, `${family.id}-desktop-dark`, replacements, options);
    await page.emulateMedia({ colorScheme: 'light' });
  }
  await open(PHONE);
  await expectReference(page, `${family.id}-phone-light`, replacements, options);
}

test.describe('@AUDIT-VISUAL rendered references of every page family', () => {
  test('login matches its references', async ({ page, world }) => {
    const replacements = await visualReplacements(world);
    for (const [variant, viewport, scheme] of [
      ['desktop-light', DESKTOP, 'light'],
      ['desktop-dark', DESKTOP, 'dark'],
      ['phone-light', PHONE, 'light'],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize(viewport);
      await page.goto('/login');
      await settlePage(page, loginSubmitButton(page));
      await expectReference(page, `login-${variant}`, replacements);
    }
  });

  for (const family of MANAGER_FAMILIES) {
    test(`${family.id} matches its references`, async ({ adminPage, world }) => {
      const details = await prepareVisualWorld(world);
      await expectFamilyReferences(adminPage, family, family.route(details), await visualReplacements(world));
    });
  }

  for (const family of FIELD_FAMILIES) {
    test(`${family.id} matches its references`, async ({ employeePage, world }) => {
      const details = await prepareVisualWorld(world);
      await expectFamilyReferences(
        employeePage,
        family,
        family.route(details),
        await visualReplacements(world),
      );
    });
  }
});
