import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { generateOrganizationCode } from '@/lib/org/schemas';

const MAX_RETRIES = 10;

/**
 * Generates a unique organization code with collision checking
 * Retries up to MAX_RETRIES times if collision detected
 *
 * Note: Uses admin client to bypass RLS since the user creating an org
 * might not be a member of any org yet, and the RLS policy on organizations
 * only allows SELECTing orgs the user is a member of.
 */
export async function generateUniqueOrgCode(): Promise<string> {
  // Use admin client to check for code collisions across ALL organizations
  const admin = createSupabaseAdminClient();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateOrganizationCode();

    // Check if code already exists (using admin client to see all orgs)
    const { data: existing, error } = await admin
      .from('organizations')
      .select('id')
      .eq('unique_code', code)
      .single();

    if (error && error.code === 'PGRST116') {
      // No rows returned - code is unique
      return code;
    }

    if (!existing) {
      // Code is unique
      return code;
    }
    // The code exists already: draw again. A collision is expected and no failure.
  }

  throw new Error(`Failed to generate unique organization code after ${MAX_RETRIES} attempts`);
}
