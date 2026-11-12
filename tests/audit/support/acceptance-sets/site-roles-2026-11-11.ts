import { managedBuilding, managedBuildingSearch, managingCustomer } from '../managed-buildings';
import { acceptanceSet, type OpenSet } from '../acceptance-sets';

/**
 * werk-flow/werkflow-planning#326 of 2026-11-11: a Hausverwaltung's two
 * buildings with their roles, tenants and access contact, the owner's
 * Einsatzort with its roles and the role dialog, the customer search by Objekt
 * number, and a customer whose Einsatzort has no roles yet.
 */
function siteRoleCaptures(): OpenSet {
  const both = { role: 'buero', widths: [1280, 375], schemes: ['light', 'dark'] } as const;
  return {
    id: 'site-roles-2026-11-11',
    captures: [
      {
        id: 'buero-hausverwaltung',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        destination: managingCustomer,
        reveal: 'Rollen an Einsatzorten',
        ...both,
      },
      {
        id: 'buero-weg-einsatzort',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        destination: managedBuilding,
        reveal: 'Rollen verwalten',
        ...both,
      },
      {
        id: 'buero-weg-rollen',
        route: '/kunden/[clientId]',
        view: { kind: 'dialog', opener: 'customers.site-roles' },
        destination: managedBuilding,
        ...both,
      },
      {
        id: 'buero-kunden-suche-objekt',
        route: '/kunden',
        view: { kind: 'page' },
        destination: managedBuildingSearch,
        ...both,
      },
      {
        id: 'buero-kunde-ohne-rollen',
        route: '/kunden/[clientId]',
        view: { kind: 'page' },
        reveal: 'Rollen nicht eingetragen',
        ...both,
      },
      {
        id: 'buero-kunde-ohne-rollen-dialog',
        route: '/kunden/[clientId]',
        view: { kind: 'dialog', opener: 'customers.site-roles' },
        ...both,
      },
    ],
    standalone: [],
  };
}

acceptanceSet(siteRoleCaptures());
