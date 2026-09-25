import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../lib/supabase/database.types";
import { requireEnv } from ".././env";
import { testSupabaseClientOptions } from ".././client-options";

// Read-only service-role lookups for gate assertions. Specs drive everything
// user-visible through the UI; these helpers only observe database state that
// the UI cannot prove (the invite code inside the email link, and the stock
// ledger behind the visible quantities).

export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    testSupabaseClientOptions,
  );
}

// The invite email link carries this code; reading it from the database is the
// harness's stand-in for opening the invitee's mailbox.
export async function getPendingInviteCode(
  orgId: string,
  email: string,
): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("organization_invites")
    .select("invite_code")
    .eq("organization_id", orgId)
    .eq("email", email.toLowerCase())
    .eq("status", "pending")
    .single();

  if (error || !data) {
    throw new Error(`No pending invite found for ${email}: ${error?.message}`);
  }
  return data.invite_code as string;
}

// Enforcement ladder Tier 1 (decision 0005): every RLS proof that signs in
// with a role's real credentials goes through this wrapper. Cleanup is always
// scope-local, so a proof can never revoke the user's sessions in the browser
// fixtures — the bare global default did exactly that at test 102 and failed
// four full certifications at the P1-16 boundary (test-incident-log.md,
// 2026-08-27). Every as-credentials helper in this file signs in through it;
// do not hand-roll createClient + signInWithPassword for a scoped RLS read.
export async function withRoleClient<T>(
  user: { email: string; password: string },
  operation: (client: SupabaseClient) => Promise<T>,
): Promise<T> {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    testSupabaseClientOptions,
  );
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error)
    throw new Error(`RLS sign-in failed for ${user.email}: ${error.message}`);
  try {
    return await operation(client);
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

export class MissingTestFixtureError extends Error {
  override readonly name = "MissingTestFixtureError";
}

export async function expectOwnerRoleMutationRejected(
  orgId: string,
  ownerUserId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("organization_members")
    .update({ role: "employee" })
    .eq("organization_id", orgId)
    .eq("user_id", ownerUserId);
  if (!error?.message.includes("organization_owner_is_protected")) {
    if (!error) {
      const { error: restoreError } = await admin
        .from("organization_members")
        .update({ role: "admin" })
        .eq("organization_id", orgId)
        .eq("user_id", ownerUserId);
      if (restoreError) {
        throw new Error(
          `Owner role mutation unexpectedly succeeded and restoration failed: ${restoreError.message}`,
        );
      }
    }
    throw new Error(
      `Owner role mutation was not rejected by the database: ${error?.message ?? "no error"}`,
    );
  }

  const { data: membership, error: readError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", ownerUserId)
    .single();
  if (readError) {
    throw new Error(
      `Owner membership verification failed: ${readError.message}`,
    );
  }
  if (membership.role !== "admin") {
    throw new Error("Owner membership changed despite last-admin protection.");
  }
}

export async function getCustomerNumber(
  orgId: string,
  customerName: string,
): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("clients")
    .select("customer_number")
    .eq("organization_id", orgId)
    .eq("name", customerName)
    .single();
  if (error || !data) {
    throw new Error(`Customer ${customerName} not found: ${error?.message}`);
  }
  return (data.customer_number as string | null) ?? null;
}
