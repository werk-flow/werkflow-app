import type { ClientSiteRole } from '@/lib/clients/site-roles';
import type { RealtimeChangeEvent } from '@/lib/realtime/events';

/** The other customers and Einsatzorte a customer page shows through its roles. */
export type RoleRelatedRecords = { clientIds: ReadonlySet<string>; siteIds: ReadonlySet<string> };

export function roleRelatedRecords(roles: readonly ClientSiteRole[] | null): RoleRelatedRecords {
  return {
    clientIds: new Set((roles ?? []).flatMap((role) => [role.holderClientId, role.siteClientId])),
    siteIds: new Set((roles ?? []).map((role) => role.siteId)),
  };
}

const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Whether a change reaches the customer page: the customer's own rows, a
 * role naming it as holder, and a renamed or archived holder, owner or
 * Einsatzort its roles show. A deletion without its owner refreshes.
 */
export function isCustomerDetailEvent(
  event: RealtimeChangeEvent,
  clientId: string,
  related: RoleRelatedRecords,
): boolean {
  const row = event.new ?? event.old;
  if (!row) return false;
  const id = textOf(row.id);
  if (event.table === 'clients') return id === clientId || (id !== null && related.clientIds.has(id));
  if (event.table === 'client_sites' && id !== null && related.siteIds.has(id)) return true;
  if (event.table === 'client_site_roles' && row.holder_client_id === clientId) return true;
  if (row.client_id === undefined) return event.eventType === 'DELETE';
  return row.client_id === clientId;
}
