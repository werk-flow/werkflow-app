import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ORGANIZATION_CODE_CHARSET, ORGANIZATION_CODE_LENGTH } from '@/lib/org/schemas';

const MAX_RETRIES = 10;
// Largest multiple of the charset size that fits a byte; bytes at or above it
// are drawn again so every character stays equally likely.
const UNBIASED_BYTE_LIMIT = 256 - (256 % ORGANIZATION_CODE_CHARSET.length);

/**
 * Generates an organization code from the cryptographic random source. The
 * code is the only secret a person needs to join a company, so it must not be
 * predictable from earlier codes.
 */
export function generateRandomCode(length: number = ORGANIZATION_CODE_LENGTH): string {
  let code = '';
  while (code.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < UNBIASED_BYTE_LIMIT && code.length < length) {
        code += ORGANIZATION_CODE_CHARSET.charAt(byte % ORGANIZATION_CODE_CHARSET.length);
      }
    }
  }
  return code;
}

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
    const code = generateRandomCode();

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
