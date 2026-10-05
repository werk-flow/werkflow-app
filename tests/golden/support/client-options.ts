import type { SupabaseClientOptions } from '@supabase/supabase-js';
import { createTransportDiagnosticFetch } from '../../../lib/testing/spec-support/transport-diagnostics';

export const testSupabaseClientOptions: SupabaseClientOptions<'public'> = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: createTransportDiagnosticFetch() },
};
