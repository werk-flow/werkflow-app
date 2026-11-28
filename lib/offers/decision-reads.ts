import 'server-only';

import { formatProfileName } from '@/lib/members/profile-name';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { acceptedScopeSchema, revisionContentSchema, type RevisionContent } from './accepted-scope';
import { ACCEPTANCE_CHANNELS, type OfferDecisions } from './types';

// The office's reads of an offer's decisions (get_offer_decisions, in the page's
// one statement) and of a sent revision's frozen content, which the Annahme
// dialog offers options from and the acceptance computes its totals from.
// The caller has established Admin or Büro of the organization.

const personSchema = z
  .object({ firstName: z.string().nullable(), lastName: z.string().nullable(), email: z.string().nullable() })
  .nullable();

const decisionsSchema = z.object({
  acceptances: z.array(
    z.object({
      id: uuidSchema,
      revision: z.number().int().positive(),
      acceptedByName: z.string(),
      acceptedOn: z.iso.date(),
      channel: z.enum(ACCEPTANCE_CHANNELS),
      note: z.string(),
      chosenOptions: z.array(z.string()),
      scope: acceptedScopeSchema,
      netCents: z.number().int(),
      taxCents: z.number().int(),
      grossCents: z.number().int(),
      validUntil: z.iso.date(),
      recordedBy: personSchema,
      withdrawal: z
        .object({ reason: z.string(), withdrawnAt: z.string(), withdrawnBy: personSchema })
        .nullable(),
    }),
  ),
  closing: z
    .object({
      outcome: z.enum(['abgelehnt', 'zurueckgezogen']),
      revision: z.number().int().positive(),
      reason: z.string(),
      recordedAt: z.string(),
      recordedBy: personSchema,
    })
    .nullable(),
});

function nameOf(person: z.infer<typeof personSchema>): string | null {
  return person
    ? formatProfileName({ first_name: person.firstName, last_name: person.lastName, email: person.email })
    : null;
}

/** The decisions get_offer_decisions answered. Throws on a malformed answer. */
export function decisionsOf(data: unknown): OfferDecisions {
  const parsed = decisionsSchema.safeParse(data);
  if (!parsed.success) throw new Error('offer_decisions_read_failed');
  const { acceptances, closing } = parsed.data;
  return {
    acceptances: acceptances.map(
      ({ netCents, taxCents, grossCents, validUntil, recordedBy, withdrawal, ...acceptance }) => ({
        ...acceptance,
        totals: { netCents, taxCents, grossCents },
        late: acceptance.acceptedOn > validUntil,
        recordedBy: nameOf(recordedBy),
        withdrawal: withdrawal && { ...withdrawal, withdrawnBy: nameOf(withdrawal.withdrawnBy) },
      }),
    ),
    closing: closing && { ...closing, recordedBy: nameOf(closing.recordedBy) },
  };
}

/** The frozen Titel and Positionen of sent revision `revision` of the organization's offer; null for none. */
export async function readRevisionContent(
  organizationId: string,
  offerId: string,
  revision: number,
): Promise<RevisionContent | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('offer_revisions')
    .select('content')
    .eq('organization_id', organizationId)
    .eq('offer_id', offerId)
    .eq('revision', revision)
    .maybeSingle();
  if (error) throw new Error('offer_revision_read_failed');
  if (!data) return null;
  const content = revisionContentSchema.safeParse(data.content);
  if (!content.success) throw new Error('offer_revision_read_failed');
  return content.data;
}
