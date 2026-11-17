import 'server-only';

import { readCompanyProfile } from '@/lib/company-profile/reads';
import { getCachedMemberships } from '@/lib/data/cached';
import type { AdminClient } from '@/lib/supabase/admin';
import { postalAddressOf, type IssueFinding, type IssueSnapshot } from './issue-model';
import type { InvoiceDetail } from './types';

// What a draft is issued from: its own lines and terms, one read of the
// company profile, and the Rechnungsempfänger's name and address. The issue
// and the draft's preview build the same invoice from them.

/** What a draft lacks before the rules can read it. */
export function completenessFindings(invoice: InvoiceDetail): IssueFinding[] {
  return [
    ...(invoice.lines.length === 0 ? [{ label: 'Mindestens eine Position', href: null }] : []),
    ...(invoice.serviceStart ? [] : [{ label: 'Leistungsdatum oder Leistungszeitraum', href: null }]),
    ...(postalAddressOf(invoice.recipient.address)
      ? []
      : [
          {
            label: 'Anschrift des Rechnungsempfängers mit Straße, Postleitzahl und Ort',
            href: `/kunden/${invoice.recipient.id}`,
          },
        ]),
  ];
}

/** The snapshot the issue stores: one read of the company profile, and the Rechnungsempfänger. */
export async function snapshotOf(
  admin: AdminClient,
  context: { userId: string; orgId: string; isManagerOrAbove: boolean },
  invoice: InvoiceDetail,
): Promise<IssueSnapshot | null> {
  const address = postalAddressOf(invoice.recipient.address);
  const [stored, memberships] = await Promise.all([
    readCompanyProfile(admin, context),
    getCachedMemberships(context.userId),
  ]);
  const organization = memberships.find((membership) => membership.orgId === context.orgId);
  if (!stored.success || !organization || !address) return null;
  return {
    organizationName: organization.name,
    profile: stored.profile.details,
    files: stored.filePaths,
    buyer: { name: invoice.recipient.name, address },
  };
}
