import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

/**
 * The dated roles of an Objekt (`client_site_roles`): who owns it, who
 * manages it and who receives its invoices by default. Each points at a
 * customer of the organization.
 */
export const SITE_ROLE_KINDS = ['eigentuemer', 'hausverwaltung', 'rechnungsempfaenger'] as const;
export type SiteRoleKind = (typeof SITE_ROLE_KINDS)[number];
export const siteRoleKindSchema = z.enum(SITE_ROLE_KINDS);

export const SITE_ROLE_LABELS: Record<SiteRoleKind, string> = {
  eigentuemer: 'Eigentümer',
  hausverwaltung: 'Hausverwaltung',
  rechnungsempfaenger: 'Rechnungsempfänger',
};

/** A contact of the Objekt's customer who lives at or opens the Objekt; never a customer. */
export const SITE_CONTACT_ROLES = ['mieter', 'zugangskontakt'] as const;
export type SiteContactRole = (typeof SITE_CONTACT_ROLES)[number];
export const siteContactRoleSchema = z.enum(SITE_CONTACT_ROLES);

export const SITE_CONTACT_ROLE_LABELS: Record<SiteContactRole, string> = {
  mieter: 'Mieter',
  zugangskontakt: 'Zugangskontakt',
};

/** One role holding on an Objekt, as `list_client_site_roles` reads it. */
export type ClientSiteRole = {
  id: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  siteSourceNumber: string | null;
  siteIsActive: boolean;
  /** The customer the Objekt is filed under. */
  siteClientId: string;
  siteClientName: string;
  holderClientId: string;
  holderName: string;
  holderArchived: boolean;
  role: SiteRoleKind;
  /** First Berlin day; null when it is not known since when. */
  startsOn: string | null;
  /** Last Berlin day, inclusive; null while the role lasts. */
  endsOn: string | null;
};

// A real calendar day: `2026-02-30` is refused, not rolled over.
const dateSchema = z.iso.date();

export const clientSiteRoleRowSchema = z.object({
  id: uuidSchema,
  site_id: uuidSchema,
  site_name: z.string(),
  site_street: z.string().nullable(),
  site_postal_code: z.string().nullable(),
  site_city: z.string().nullable(),
  site_source_number: z.string().nullable(),
  site_is_active: z.boolean(),
  site_client_id: uuidSchema,
  site_client_name: z.string(),
  holder_client_id: uuidSchema,
  holder_name: z.string(),
  holder_archived_at: z.string().nullable(),
  // A kind a later release adds is left out by the reader.
  role: z.string(),
  starts_on: dateSchema.nullable(),
  ends_on: dateSchema.nullable(),
});

/** A Berlin calendar day (`YYYY-MM-DD`) a role starts or ends on. */
export const siteRoleDateSchema = dateSchema;

/** Where a role stands on a Berlin day: past, current or not yet begun. */
type SiteRoleState = 'ended' | 'current' | 'upcoming';

export function siteRoleState(
  role: Pick<ClientSiteRole, 'startsOn' | 'endsOn'>,
  today: string,
): SiteRoleState {
  if (role.endsOn !== null && role.endsOn < today) return 'ended';
  if (role.startsOn !== null && role.startsOn > today) return 'upcoming';
  return 'current';
}

/** Today's Berlin calendar day, the day a role is current on. */
export function berlinToday(now: Date = new Date()): string {
  return formatBerlinLocalDate(now);
}

/** „seit 01.07.2026“, „01.01.2020 – 30.06.2026“, „ab 01.01.2027“ or „seit unbekannt“. */
export function describeSiteRolePeriod(
  role: Pick<ClientSiteRole, 'startsOn' | 'endsOn'>,
  today: string,
  formatDate: (date: string) => string,
): string {
  const start = role.startsOn ? formatDate(role.startsOn) : null;
  if (role.endsOn !== null) return `${start ?? 'unbekannt'} – ${formatDate(role.endsOn)}`;
  if (start === null) return 'seit unbekannt';
  return siteRoleState(role, today) === 'upcoming' ? `ab ${start}` : `seit ${start}`;
}
