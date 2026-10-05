import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../lib/supabase/database.types';
import { requireEnv } from '.././env';
import { testSupabaseClientOptions } from '.././client-options';

// Read-only service-role lookups for gate assertions. Specs drive everything
// user-visible through the UI; these helpers only observe database state that
// the UI cannot prove (the invite code inside the email link, and the stock
// ledger behind the visible quantities).

export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SECRET_KEY'),
    testSupabaseClientOptions,
  );
}

// The invite email link carries this code; reading it from the database is the
// harness's stand-in for opening the invitee's mailbox.
export async function getPendingInviteCode(orgId: string, email: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('organization_invites')
    .select('invite_code')
    .eq('organization_id', orgId)
    .eq('email', email.toLowerCase())
    .eq('status', 'pending')
    .single();

  if (error || !data) {
    throw new Error(`No pending invite found for ${email}: ${error?.message}`);
  }
  return data.invite_code as string;
}

export class MissingTestFixtureError extends Error {
  override readonly name = 'MissingTestFixtureError';
}

// The join code an admin hands out; reading it stands in for that hand-over.
export async function getOrganizationJoinCode(orgId: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('organizations')
    .select('unique_code')
    .eq('id', orgId)
    .single();
  if (error) throw new Error(`Organization join code lookup failed: ${error.message}`);
  return data.unique_code;
}

// The stored states of one person's join requests to one organization, oldest first.
export async function getJoinRequestStatuses(orgId: string, email: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();
  if (profileError) throw new Error(`Profile lookup for ${email} failed: ${profileError.message}`);
  const { data, error } = await admin
    .from('organization_join_requests')
    .select('status')
    .eq('organization_id', orgId)
    .eq('user_id', profile.id)
    .order('requested_at');
  if (error) throw new Error(`Join request lookup failed: ${error.message}`);
  return data.map((row) => row.status);
}

export async function getCustomerNumber(orgId: string, customerName: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from('clients')
    .select('customer_number')
    .eq('organization_id', orgId)
    .eq('name', customerName)
    .single();
  if (error || !data) {
    throw new Error(`Customer ${customerName} not found: ${error?.message}`);
  }
  return (data.customer_number as string | null) ?? null;
}
