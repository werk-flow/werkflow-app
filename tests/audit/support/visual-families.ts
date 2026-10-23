import { expect, type Page } from '@playwright/test';
import type { InventoriedRoute } from '../../../lib/testing/selection/mobile-route-inventory';
import type { StandaloneRoute } from '../../../lib/testing/selection/standalone-route-inventory';
import { CALENDAR_PAGE_TITLE } from '../../golden/support/plantafel';
import { DOCUMENT_LIBRARY_TITLE } from '../../golden/support/steps/documents';
import { SERVICE_AREA_HEADER } from '../../golden/support/steps/service';
import {
  periodListHeading,
  periodOpenLinks,
  TIME_ACCOUNT_COPY,
  TIME_AREA_HEADER,
} from '../../golden/support/steps/time-tracking';
import { ownedBerlinWeekAtOffset } from '../../golden/support/date-ownership';
import type { TestWorld } from '../../golden/support/world';
import { prepareVisualCalendarWeek, VISUAL_NAMES, type VisualDetails } from './visual-fixtures';

// The page families of the visual references (tests/audit/visual/references.spec.ts):
// one reference per family, desktop and phone, each in light and dark mode.
// A family stands for the inventory routes that render its page (`covers`);
// lib/testing/selection/visual-families.test.ts fails when a route of the
// inventories has no family or a family lacks one of its references.
// docs/technical/standards-audit.md owns the acceptance and update rules.

/** Seeds the populated calendar week once per world and returns its address. */
async function visualCalendarRoute(world: TestWorld): Promise<string> {
  // The member records start on the run day, so the week belongs to it: the first whole week on or after +165.
  const monday = ownedBerlinWeekAtOffset('visual-references', 165);
  await prepareVisualCalendarWeek(world, monday);
  return `/kalender?date=${monday}`;
}
/** A fixed month for the prepared period: before the seeded entry dates, so its result is constant. */
const PERIOD_MONTH = '2026-03';

export type AppFamily = {
  /** Reference file prefix. */
  id: string;
  role: 'admin' | 'employee';
  /** The inventory routes whose page this family's reference shows. */
  covers: readonly InventoriedRoute[];
  /** The address, or a preparation that returns it. */
  route: (details: VisualDetails, page: Page, world: TestWorld) => string | Promise<string>;
  /** The page's level-one heading, so an error page never becomes a reference. */
  heading: string;
  /** The record's own heading below an area heading. */
  title?: string;
  /**
   * The calendar of the populated week: its preparation plans the visual jobs,
   * so it runs after every other family (`APP_FAMILY_RUN_ORDER`), and its
   * references also replace the week's range, week number and day numbers.
   */
  calendarWeek?: true;
};

export type StandaloneFamily = {
  id: string;
  screen: StandaloneRoute;
  /** The screen's StandaloneTitle. */
  heading: string;
};

const fixed = (route: string) => (): string => route;

/** Prepares the period of the fixed month once per world and returns its address. */
async function visualPeriodRoute(page: Page): Promise<string> {
  await page.goto('/zeiterfassung/perioden');
  const content = page.getByRole('main').locator('[data-page-body]');
  await expect(periodListHeading(content)).toBeVisible();
  const open = periodOpenLinks(content);
  if ((await open.count()) === 0) {
    const monthInput = content.getByRole('textbox', { name: TIME_ACCOUNT_COPY.month, exact: true });
    await expect(monthInput).toHaveValue(/^\d{2}\.\d{4}$/);
    await monthInput.fill(PERIOD_MONTH);
    await monthInput.blur();
    await content.getByRole('button', { name: TIME_ACCOUNT_COPY.preparePeriod, exact: true }).click();
    await expect(page).toHaveURL(/\/zeiterfassung\/perioden\/[0-9a-f-]{36}$/);
    return new URL(page.url()).pathname;
  }
  await expect(open).toHaveCount(1);
  const route = await open.getAttribute('href');
  if (!route) throw new Error('The prepared period exposes no detail route.');
  return route;
}

const SETTINGS_SECTIONS = [
  'profil',
  'organisation',
  'zeiterfassung',
  'kunden',
  'dashboard',
  'kalender',
  'konto-sicherheit',
  'abonnement-abrechnung',
  'mitarbeiter',
  'auftraege-projekte',
] as const;

export const APP_FAMILIES: readonly AppFamily[] = [
  {
    id: 'dashboard',
    role: 'admin',
    covers: ['/dashboard'],
    route: fixed('/dashboard'),
    heading: 'Dashboard',
  },
  { id: 'aufgaben', role: 'admin', covers: ['/aufgaben'], route: fixed('/aufgaben'), heading: 'Aufgaben' },
  { id: 'auftraege', role: 'admin', covers: ['/auftraege'], route: fixed('/auftraege'), heading: 'Aufträge' },
  {
    id: 'auftrag',
    role: 'admin',
    // The project-scoped job detail renders the same page.
    covers: ['/auftraege/[jobNumber]', '/auftraege/projekt/[projectNumber]/[jobNumber]'],
    route: fixed(`/auftraege/${VISUAL_NAMES.jobNumber}`),
    heading: VISUAL_NAMES.job,
  },
  {
    id: 'uebergabe',
    role: 'admin',
    // Every handover route renders WorkHandoverPage for its job or project.
    covers: [
      '/auftraege/[jobNumber]/uebergabe',
      '/auftraege/projekt/[projectNumber]/uebergabe',
      '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe',
      '/auftraege/uebergaben/[targetType]/[targetId]',
    ],
    route: fixed(`/auftraege/${VISUAL_NAMES.jobNumber}/uebergabe`),
    heading: VISUAL_NAMES.job,
  },
  {
    id: 'projekt',
    role: 'admin',
    covers: ['/auftraege/projekt/[projectNumber]'],
    route: fixed(`/auftraege/projekt/${VISUAL_NAMES.projectNumber}`),
    heading: VISUAL_NAMES.project,
  },
  { id: 'kunden', role: 'admin', covers: ['/kunden'], route: fixed('/kunden'), heading: 'Kunden' },
  {
    id: 'kunde',
    role: 'admin',
    covers: ['/kunden/[clientId]'],
    route: (details) => `/kunden/${details.familyClientId}`,
    heading: VISUAL_NAMES.family,
  },
  { id: 'anfragen', role: 'admin', covers: ['/anfragen'], route: fixed('/anfragen'), heading: 'Anfragen' },
  {
    id: 'anfrage',
    role: 'admin',
    covers: ['/anfragen/[requestId]'],
    route: (details) => `/anfragen/${details.requestId}`,
    heading: VISUAL_NAMES.request,
  },
  {
    id: 'dokumente',
    role: 'admin',
    covers: ['/dokumente'],
    route: fixed('/dokumente'),
    heading: DOCUMENT_LIBRARY_TITLE,
  },
  { id: 'inventar', role: 'admin', covers: ['/inventar'], route: fixed('/inventar'), heading: 'Inventar' },
  {
    id: 'qualifikationen',
    role: 'admin',
    covers: ['/qualifikationen'],
    route: fixed('/qualifikationen'),
    heading: 'Qualifikationen',
  },
  {
    id: 'arbeitsvorlagen',
    role: 'admin',
    covers: ['/arbeitsvorlagen'],
    route: fixed('/arbeitsvorlagen'),
    heading: 'Arbeitsvorlagen',
  },
  {
    id: 'mitarbeiter',
    role: 'admin',
    covers: ['/mitarbeiter'],
    route: fixed('/mitarbeiter'),
    heading: 'Mitarbeiter',
  },
  {
    id: 'mitarbeiter-detail',
    role: 'admin',
    covers: ['/mitarbeiter/[userId]'],
    route: (_details, _page, world) => `/mitarbeiter/${world.users.employee.id}`,
    heading: 'Kevin Schmid',
  },
  {
    id: 'service-faelle',
    role: 'admin',
    covers: ['/service/faelle'],
    route: fixed('/service/faelle'),
    heading: SERVICE_AREA_HEADER.title,
  },
  {
    id: 'service-fall',
    role: 'admin',
    covers: ['/service/faelle/[caseNumber]'],
    route: (details) => `/service/faelle/${details.caseNumber}`,
    heading: SERVICE_AREA_HEADER.title,
    title: VISUAL_NAMES.serviceCase,
  },
  {
    id: 'service-anlagen',
    role: 'admin',
    covers: ['/service/anlagen'],
    route: fixed('/service/anlagen'),
    heading: SERVICE_AREA_HEADER.title,
  },
  {
    id: 'service-anlage',
    role: 'admin',
    covers: ['/service/anlagen/[equipmentNumber]'],
    route: (details) => `/service/anlagen/${details.equipmentNumber}`,
    heading: SERVICE_AREA_HEADER.title,
    title: VISUAL_NAMES.equipment,
  },
  {
    id: 'service-wartung',
    role: 'admin',
    covers: ['/service/wartung'],
    route: fixed('/service/wartung'),
    heading: SERVICE_AREA_HEADER.title,
  },
  {
    id: 'zeiterfassung',
    role: 'admin',
    covers: ['/zeiterfassung'],
    route: fixed('/zeiterfassung'),
    heading: TIME_AREA_HEADER.title,
  },
  {
    id: 'zeitkonto',
    role: 'admin',
    covers: ['/zeiterfassung/zeitkonto'],
    route: fixed('/zeiterfassung/zeitkonto'),
    heading: TIME_AREA_HEADER.title,
  },
  {
    id: 'perioden',
    role: 'admin',
    covers: ['/zeiterfassung/perioden'],
    route: fixed('/zeiterfassung/perioden'),
    heading: TIME_AREA_HEADER.title,
  },
  {
    id: 'zeiterfassung-einstellungen',
    role: 'admin',
    covers: ['/zeiterfassung/einstellungen'],
    route: fixed('/zeiterfassung/einstellungen'),
    heading: TIME_AREA_HEADER.title,
  },
  ...SETTINGS_SECTIONS.map(
    (section): AppFamily => ({
      id: `einstellungen-${section}`,
      role: 'admin',
      covers: [`/einstellungen/${section}`],
      route: fixed(`/einstellungen/${section}`),
      heading: 'Einstellungen',
    }),
  ),
  {
    id: 'kalender',
    role: 'admin',
    covers: ['/kalender'],
    route: (_details, _page, world) => visualCalendarRoute(world),
    heading: CALENDAR_PAGE_TITLE,
    calendarWeek: true,
  },
  {
    // Last: the preparation adds the period that the list above would show.
    id: 'periode',
    role: 'admin',
    covers: ['/zeiterfassung/perioden/[periodId]'],
    route: (_details, page) => visualPeriodRoute(page),
    heading: TIME_AREA_HEADER.title,
  },
  // The field worker's own view: the lowest bar for clarity, so it has its own references.
  {
    id: 'handwerker-dashboard',
    role: 'employee',
    covers: ['/dashboard'],
    route: fixed('/dashboard'),
    heading: 'Dashboard',
  },
  {
    id: 'handwerker-auftrag',
    role: 'employee',
    covers: ['/auftraege/[jobNumber]', '/auftraege/projekt/[projectNumber]/[jobNumber]'],
    route: fixed(`/auftraege/${VISUAL_NAMES.jobNumber}`),
    heading: VISUAL_NAMES.job,
  },
  {
    id: 'handwerker-aufgaben',
    role: 'employee',
    covers: ['/aufgaben'],
    route: fixed('/aufgaben'),
    heading: 'Aufgaben',
  },
  {
    id: 'handwerker-kalender',
    role: 'employee',
    covers: ['/kalender'],
    route: (_details, _page, world) => visualCalendarRoute(world),
    heading: CALENDAR_PAGE_TITLE,
    calendarWeek: true,
  },
  {
    id: 'handwerker-zeiterfassung',
    role: 'employee',
    covers: ['/zeiterfassung'],
    route: fixed('/zeiterfassung'),
    heading: TIME_AREA_HEADER.title,
  },
  {
    id: 'handwerker-auftraege',
    role: 'employee',
    covers: ['/auftraege'],
    route: fixed('/auftraege'),
    heading: 'Aufträge',
  },
  {
    id: 'handwerker-qualifikationen',
    role: 'employee',
    covers: ['/qualifikationen'],
    route: fixed('/qualifikationen'),
    heading: 'Qualifikationen',
  },
  {
    id: 'handwerker-einstellungen-profil',
    role: 'employee',
    covers: ['/einstellungen/profil'],
    route: fixed('/einstellungen/profil'),
    heading: 'Einstellungen',
  },
];

export const STANDALONE_FAMILIES: readonly StandaloneFamily[] = [
  { id: 'login', screen: '/login', heading: 'Willkommen zurück' },
  { id: 'signup', screen: '/signup', heading: 'Erstelle dein Konto' },
  { id: 'passwort-vergessen', screen: '/forgot-password', heading: 'Passwort zurücksetzen' },
  { id: 'passwort-neu', screen: '/reset-password', heading: 'Neues Passwort festlegen' },
  { id: 'verifizierung', screen: '/verify', heading: 'Verifizierungscode eingeben' },
  { id: 'einladung-fehler', screen: '/invite-error', heading: 'Einladung abgelaufen' },
  {
    id: 'anmeldung-nicht-erreichbar',
    screen: '/auth/unavailable',
    heading: 'Anmeldung gerade nicht erreichbar',
  },
  { id: 'nicht-gefunden', screen: 'not-found', heading: 'Seite nicht gefunden' },
  { id: 'onboarding-start', screen: '/onboarding/start', heading: 'Willkommen bei WerkFlow' },
  { id: 'onboarding-beitreten', screen: '/onboarding/join-organization', heading: 'Organisation beitreten' },
  { id: 'upgrade', screen: '/upgrade', heading: 'WerkFlow Pro' },
  {
    id: 'onboarding-organisation',
    screen: '/onboarding/create-organization',
    heading: 'Lass uns deine Organisation erstellen',
  },
  { id: 'onboarding-vorstart', screen: '/onboarding/meine-aufgaben', heading: 'Dein Start bei WerkFlow' },
];

/**
 * The order the spec runs the app families in: a calendar family plans the
 * visual jobs, so every family that shows a job renders before it, in a whole
 * run and in a focused one alike.
 */
export const APP_FAMILY_RUN_ORDER: readonly AppFamily[] = [
  ...APP_FAMILIES.filter((family) => !family.calendarWeek),
  ...APP_FAMILIES.filter((family) => family.calendarWeek),
];

/** Every reference name of a family: the desktop and the phone, each in both schemes. */
export function familyReferenceNames(id: string): readonly string[] {
  return [`${id}-desktop-light`, `${id}-desktop-dark`, `${id}-phone-light`, `${id}-phone-dark`];
}
