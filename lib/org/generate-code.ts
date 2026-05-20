import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  ORGANIZATION_CODE_CHARSET,
  ORGANIZATION_CODE_LENGTH,
} from '@/lib/org/schemas';

// Characters that are unambiguous (no 0/O, 1/I/L confusion)
const MAX_RETRIES = 10;

/**
 * Generates a random alphanumeric code of specified length
 */
function generateRandomCode(length: number = ORGANIZATION_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ORGANIZATION_CODE_CHARSET.charAt(
      Math.floor(Math.random() * ORGANIZATION_CODE_CHARSET.length)
    );
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

    // Code exists, retry
    console.log(`Code collision on attempt ${attempt + 1}, retrying...`);
  }

  throw new Error(
    `Failed to generate unique organization code after ${MAX_RETRIES} attempts`
  );
}
