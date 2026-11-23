import { randomUUID } from 'node:crypto';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from './shared';

// The company document profile, written through the function the settings
// form's action calls (lib/company-profile/actions.ts).

/** A made-up company whose details the EN 16931 rules accept as seller and payee. */
const RULE_READY_PROFILE = {
  company_name: 'Haustechnik Sonnenberg GmbH',
  street: 'Sonnenweg 1',
  postal_code: '01234',
  city: 'Sonnenstadt',
  phone: '0123 456789',
  email: 'info@sonnenberg.example',
  website: 'sonnenberg.example',
  register_court: 'Amtsgericht Sonnenstadt',
  register_number: 'HRB 00000',
  managing_directors: 'Geschäftsführerin: Erika Musterfrau',
  tax_number: '000/000/00000',
  vat_id: 'DE123456789',
  bank_name: 'Musterbank',
  iban: 'DE00 1111 1111 1111 1111 11',
  bic: 'MUSTDEXXXXX',
  offer_opening_text: 'Guten Tag,\nvielen Dank für die Anfrage. Gerne bieten wir an:',
  offer_closing_text: 'Wir freuen uns auf den Auftrag.\n\nViele Grüße\nHaustechnik Sonnenberg GmbH',
  offer_validity_days: 30,
  standard_tax_rate_basis_points: 1900,
  stationery_first_top_mm: 45,
  stationery_first_right_mm: 20,
  stationery_first_bottom_mm: 25,
  stationery_first_left_mm: 25,
  stationery_following_top_mm: 30,
  stationery_following_right_mm: 20,
  stationery_following_bottom_mm: 25,
  stationery_following_left_mm: 25,
};

/** Saves a complete company profile for the organization, over whatever version it holds. */
export async function seedRuleReadyCompanyProfile(scope: { orgId: string; actorId: string }): Promise<void> {
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from('company_document_profiles')
    .select('version')
    .eq('organization_id', scope.orgId)
    .maybeSingle();
  if (error) throw new Error(`company profile read failed: ${error.message}`);
  const { error: saveError } = await admin.rpc(
    'save_company_document_profile',
    rpcArgs('save_company_document_profile', {
      p_actor_id: scope.actorId,
      p_organization_id: scope.orgId,
      p_expected_version: row?.version ?? 0,
      p_values: RULE_READY_PROFILE,
      p_attempt_key: randomUUID(),
    }),
  );
  if (saveError) throw new Error(`company profile seed failed: ${saveError.message}`);
}
