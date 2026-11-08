/**
 * The Supabase project the auth URL contracts bundle the real browser client
 * against. Nothing answers at this address: the spec routes every request.
 */
export const CONTRACT_SUPABASE_URL = 'http://supabase.contract.test';
export const CONTRACT_SUPABASE_PUBLISHABLE_KEY = 'contract-publishable-key';
/** The browser client keeps its session under `sb-<first host label>-auth-token`. */
export const CONTRACT_SESSION_COOKIE = 'sb-supabase-auth-token';
