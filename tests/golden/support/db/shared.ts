import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../../lib/supabase/database.types';
import { requireEnv } from '.././env';
import { testSupabaseClientOptions } from '.././client-options';

// Read-only service-role lookups for gate assertions. Specs drive everything
// user-visible through the UI; these helpers only observe database state that
// the UI cannot prove (the invite code inside the email link, and the stock
// ledger behind the visible quantities).

declare const persistedBrand: unique symbol;

/**
 * A row read back from the database after the UI saved it. A mutation step
 * helper that returns a value returns this type, so it must call a reader in
 * this folder: the screen or the URL can show an optimistic echo, the database
 * cannot (testing.md, "Spec checklist"). Only `persisted` below builds one;
 * ESLint refuses a cast to it and an import of `persisted` outside db/.
 */
export type Persisted<Row> = Row & { readonly [persistedBrand]: true };

/** Brands a row that a reader in this folder just read through the admin client. */
export function persisted<Row extends object>(row: Row): Persisted<Row> {
  return row as Persisted<Row>;
}

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

export type PersistedJoinCode = Persisted<{ organizationId: string; name: string; code: string }>;

/** The organization that owns a join code, read after the screen showed the code. */
export async function getOrganizationByJoinCode(code: string): Promise<PersistedJoinCode> {
  const { data, error } = await createAdminClient()
    .from('organizations')
    .select('id, name, unique_code')
    .eq('unique_code', code)
    .single();
  if (error) throw new Error(`Organization lookup by the shown join code failed: ${error.message}`);
  return persisted({ organizationId: data.id, name: data.name, code: data.unique_code });
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
