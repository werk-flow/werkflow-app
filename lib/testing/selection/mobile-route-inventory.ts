// Every authenticated page must have an executable phone case or a verified redirect.
// Keep variants explicit: shared components can receive different data and role branches.
export const MANAGER_PHONE_ROUTES = [
  '/dashboard',
  '/aufgaben',
  '/kalender',
  '/zeiterfassung',
  '/zeiterfassung/zeitkonto',
  '/zeiterfassung/perioden',
  '/zeiterfassung/einstellungen',
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
  '/einstellungen/kunden',
  '/einstellungen/dashboard',
  '/einstellungen/kalender',
  '/einstellungen/konto-sicherheit',
  '/einstellungen/organisation',
  '/einstellungen/abonnement-abrechnung',
  '/einstellungen/mitarbeiter',
  '/einstellungen/auftraege-projekte',
] as const;

export const DYNAMIC_PHONE_ROUTES = [
  '/kunden/[clientId]',
  '/anfragen/[requestId]',
  '/auftraege/[jobNumber]',
  '/mitarbeiter/[userId]',
  '/auftraege/[jobNumber]/uebergabe',
  '/auftraege/projekt/[projectNumber]',
  '/auftraege/projekt/[projectNumber]/uebergabe',
  '/auftraege/projekt/[projectNumber]/[jobNumber]',
  '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe',
  '/auftraege/uebergaben/[targetType]/[targetId]',
  '/service/anlagen/[equipmentNumber]',
  '/service/faelle/[caseNumber]',
  '/zeiterfassung/perioden/[periodId]',
] as const;

export const PHONE_REDIRECTS = [
  { route: '/service', destination: '/service/faelle' },
  { route: '/einstellungen', destination: '/einstellungen/profil' },
] as const;

/**
 * The pages a field worker opens, audited with the employee session at 375 px
 * (the sidebar shows them to every role). The work pack is the employee view
 * of the job detail patterns above.
 */
export const EMPLOYEE_PHONE_ROUTES = [
  '/dashboard',
  '/aufgaben',
  '/kalender',
  '/zeiterfassung',
  '/auftraege',
  '/qualifikationen',
  '/einstellungen/profil',
] as const satisfies readonly (typeof MANAGER_PHONE_ROUTES)[number][];

/** The detail patterns a field worker opens as the work pack. */
export const EMPLOYEE_WORK_PACKS = [
  '/auftraege/[jobNumber]',
  '/auftraege/projekt/[projectNumber]/[jobNumber]',
] as const satisfies readonly (typeof DYNAMIC_PHONE_ROUTES)[number][];

export type DynamicPhoneRoute = (typeof DYNAMIC_PHONE_ROUTES)[number];

/** A page of the inventory: a static route or a detail pattern. */
export type InventoriedRoute = (typeof MANAGER_PHONE_ROUTES)[number] | DynamicPhoneRoute;

/** The sessions the rendered audit opens pages with. */
export type SurfaceRole = 'admin' | 'employee';
