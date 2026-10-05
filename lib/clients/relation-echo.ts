import type { SaveClientContactInput, SaveClientSiteInput } from './actions';
import type { ClientContact, ClientSite } from './types';

const textOrNull = (value: string | undefined): string | null => value?.trim() || null;

function newRecordFields(
  clientId: string,
): Pick<ClientContact, 'organizationId' | 'clientId' | 'isActive' | 'createdBy' | 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString();
  // The organization and author are the server's facts; the echo shows neither.
  return { organizationId: '', clientId, isActive: true, createdBy: null, createdAt: now, updatedAt: now };
}

/** The contact a saved dialog shows until the server confirms it. */
export function buildContactEcho(
  base: ClientContact | { id: string; clientId: string },
  draft: SaveClientContactInput,
): ClientContact {
  return {
    ...('name' in base ? base : { ...newRecordFields(base.clientId), id: base.id }),
    name: draft.name.trim(),
    role: textOrNull(draft.role),
    email: textOrNull(draft.email),
    phone: textOrNull(draft.phone),
    notes: textOrNull(draft.notes),
    isPrimary: draft.isPrimary ?? false,
  };
}

/** The work site a saved dialog shows until the server confirms it. */
export function buildSiteEcho(
  base: ClientSite | { id: string; clientId: string },
  draft: SaveClientSiteInput,
): ClientSite {
  return {
    ...('name' in base ? base : { ...newRecordFields(base.clientId), id: base.id }),
    name: draft.name.trim(),
    street: textOrNull(draft.street),
    postalCode: textOrNull(draft.postalCode),
    city: textOrNull(draft.city),
    accessNotes: textOrNull(draft.accessNotes),
    notes: textOrNull(draft.notes),
    primaryContactId: draft.primaryContactId ?? null,
    isPrimary: draft.isPrimary ?? false,
  };
}

/** A pending primary choice takes the mark from its previous holder at once, as the server will. */
export function withPendingPrimary<Item extends { isPrimary: boolean }>(
  rows: ReadonlyArray<{ item: Item; isOptimistic: boolean }>,
): Item[] {
  const hasPendingPrimary = rows.some((row) => row.isOptimistic && row.item.isPrimary);
  return rows.map((row) =>
    hasPendingPrimary && !row.isOptimistic && row.item.isPrimary
      ? { ...row.item, isPrimary: false }
      : row.item,
  );
}
