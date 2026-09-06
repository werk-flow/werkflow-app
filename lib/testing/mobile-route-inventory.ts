// Every authenticated page must have an executable phone case or a verified redirect.
// Keep variants explicit: shared components can receive different data and role branches.
export const MANAGER_PHONE_ROUTES = [
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
  "/einstellungen/kunden",
  "/einstellungen/dashboard",
  "/einstellungen/kalender",
  "/einstellungen/konto-sicherheit",
  "/einstellungen/organisation",
  "/einstellungen/abonnement-abrechnung",
  "/einstellungen/mitarbeiter",
  "/einstellungen/auftraege-projekte"
] as const;

export const DYNAMIC_PHONE_ROUTES = [
  "/kunden/[clientId]",
  "/anfragen/[requestId]",
  "/auftraege/[jobNumber]",
  "/mitarbeiter/[userId]",
  "/auftraege/[jobNumber]/uebergabe",
  "/auftraege/projekt/[projectNumber]",
  "/auftraege/projekt/[projectNumber]/uebergabe",
  "/auftraege/projekt/[projectNumber]/[jobNumber]",
  "/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe",
  "/auftraege/uebergaben/[targetType]/[targetId]",
  "/service/anlagen/[equipmentNumber]",
  "/service/faelle/[caseNumber]",
  "/zeiterfassung/perioden/[periodId]"
] as const;

export const PHONE_REDIRECTS = [
  { route: '/service', destination: '/service/faelle' },
  { route: '/einstellungen', destination: '/einstellungen/profil' },
] as const;

export type DynamicPhoneRoute = typeof DYNAMIC_PHONE_ROUTES[number];
