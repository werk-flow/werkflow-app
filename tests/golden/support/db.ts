import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from './env';

// Read-only service-role lookups for gate assertions. Specs drive everything
// user-visible through the UI; these helpers only observe database state that
// the UI cannot prove (the invite code inside the email link, and the stock
// ledger behind the visible quantities).

function createAdminClient(): SupabaseClient {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

export type RequestConversionState = {
  status: string;
  convertedJobId: string | null;
  convertedProjectId: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
};

// P1-02: DB-side proof that a conversion happened exactly once and is
// attributable — the UI shows the link, this shows the once-only facts.
export async function getRequestConversionState(
  orgId: string,
  requestNumber: string
): Promise<RequestConversionState> {
  const { data, error } = await createAdminClient()
    .from('client_requests')
    .select('status, converted_job_id, converted_project_id, converted_at, converted_by')
    .eq('organization_id', orgId)
    .eq('request_number', requestNumber)
    .single();

  if (error || !data) {
    throw new Error(`No request found with number ${requestNumber}: ${error?.message}`);
  }

  return {
    status: data.status as string,
    convertedJobId: (data.converted_job_id as string | null) ?? null,
    convertedProjectId: (data.converted_project_id as string | null) ?? null,
    convertedAt: (data.converted_at as string | null) ?? null,
    convertedBy: (data.converted_by as string | null) ?? null,
  };
}

export type EmployeeRecordState = {
  id: string;
  userId: string | null;
  employeeNumber: string | null;
  entryDate: string | null;
  exitDate: string | null;
  recordCountForUser: number;
  // Null once the membership was removed (e.g. the destructive-removal check).
  membershipJoinedAt: string | null;
};

// P1-03: DB-side proof for personnel facts the UI cannot show directly —
// exactly one record per person per organization, the backfilled entry date,
// and the exit marking after a destructive membership removal.
export async function getEmployeeRecordStateByUser(
  orgId: string,
  userId: string
): Promise<EmployeeRecordState> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id, user_id, employee_number, entry_date, exit_date')
    .eq('organization_id', orgId)
    .eq('user_id', userId);

  if (error || !data || data.length === 0) {
    throw new Error(`No employee record found for user ${userId}: ${error?.message}`);
  }

  const { data: membership } = await admin
    .from('organization_members')
    .select('joined_at')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  const row = data[0];
  return {
    id: row.id as string,
    userId: (row.user_id as string | null) ?? null,
    employeeNumber: (row.employee_number as string | null) ?? null,
    entryDate: (row.entry_date as string | null) ?? null,
    exitDate: (row.exit_date as string | null) ?? null,
    recordCountForUser: data.length,
    membershipJoinedAt: (membership?.joined_at as string | null) ?? null,
  };
}

// P1-04: which work-schedule rows a real signed-in user can see under RLS.
// The UI never shows foreign schedules, so the self-or-manager SELECT policy
// (managers all org rows, a person exactly their own) is proved here.
// Deliberately no signOut: the default scope would revoke the user's other
// sessions and break the browser fixtures of later tests.
export async function getVisibleWorkScheduleRecordIdsAs(
  user: { email: string; password: string },
  orgId: string
): Promise<string[]> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const { data, error } = await client
    .from('work_schedules')
    .select('employee_record_id')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(`work_schedules query failed for ${user.email}: ${error.message}`);
  }

  return [...new Set((data ?? []).map((row) => row.employee_record_id as string))];
}

export type ResponsibilityConfigurationState = {
  id: string;
  mode: string;
  holderEmployeeRecordIds: string[];
};

export async function getLatestResponsibilityConfigurationState(
  orgId: string,
  responsibility: 'time_approval' | 'leave_approval'
): Promise<ResponsibilityConfigurationState> {
  const admin = createAdminClient();
  const { data: configuration, error } = await admin
    .from('organization_responsibility_configurations')
    .select('id, mode')
    .eq('organization_id', orgId)
    .eq('responsibility', responsibility)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !configuration) {
    throw new Error(`Responsibility configuration missing: ${error?.message}`);
  }

  const { data: assignments, error: assignmentError } = await admin
    .from('organization_responsibility_assignments')
    .select('employee_record_id')
    .eq('configuration_id', configuration.id);
  if (assignmentError) {
    throw new Error(`Responsibility assignments query failed: ${assignmentError.message}`);
  }

  return {
    id: configuration.id as string,
    mode: configuration.mode as string,
    holderEmployeeRecordIds: (assignments ?? [])
      .map((assignment) => assignment.employee_record_id as string)
      .sort(),
  };
}

export async function getVisibleResponsibilityEmployeeRecordIdsAs(
  user: { email: string; password: string },
  orgId: string
): Promise<string[]> {
  const client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (signInError) {
    throw new Error(`Sign-in failed for ${user.email}: ${signInError.message}`);
  }

  const { data, error } = await client
    .from('organization_responsibility_assignments')
    .select('employee_record_id')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(`Responsibility RLS query failed for ${user.email}: ${error.message}`);
  }

  return [
    ...new Set((data ?? []).map((row) => row.employee_record_id as string)),
  ].sort();
}

export async function getLatestManualTimeEntryState(
  orgId: string,
  userId: string
): Promise<{ id: string; status: string }> {
  const { data, error } = await createAdminClient()
    .from('time_entries')
    .select('id, status')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('is_manual', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(`Pending time entry missing for ${userId}: ${error?.message}`);
  }
  return { id: data.id as string, status: data.status as string };
}

export async function expectOwnerRoleMutationRejected(
  orgId: string,
  ownerUserId: string
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('organization_members')
    .update({ role: 'employee' })
    .eq('organization_id', orgId)
    .eq('user_id', ownerUserId);
  if (!error?.message.includes('organization_owner_is_protected')) {
    if (!error) {
      const { error: restoreError } = await admin
        .from('organization_members')
        .update({ role: 'admin' })
        .eq('organization_id', orgId)
        .eq('user_id', ownerUserId);
      if (restoreError) {
        throw new Error(
          `Owner role mutation unexpectedly succeeded and restoration failed: ${restoreError.message}`
        );
      }
    }
    throw new Error(
      `Owner role mutation was not rejected by the database: ${error?.message ?? 'no error'}`
    );
  }

  const { data: membership, error: readError } = await admin
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', ownerUserId)
    .single();
  if (readError) {
    throw new Error(`Owner membership verification failed: ${readError.message}`);
  }
  if (membership.role !== 'admin') {
    throw new Error('Owner membership changed despite last-admin protection.');
  }
}

export type InventoryLedgerState = {
  quantityOnHand: number;
  movementTotal: number;
  lastQuantityAfter: number;
  movementCount: number;
};

// Snapshot of one item/location pair: the stored stock level plus what the
// movement ledger implies. A consistent ledger means quantityOnHand equals
// both the sum of all deltas and the last movement's quantity_after.
export async function getInventoryLedgerState(
  orgId: string,
  itemId: string,
  locationId: string
): Promise<InventoryLedgerState> {
  const admin = createAdminClient();

  const { data: stockLevel, error: stockError } = await admin
    .from('inventory_stock_levels')
    .select('quantity_on_hand')
    .eq('organization_id', orgId)
    .eq('item_id', itemId)
    .eq('location_id', locationId)
    .maybeSingle();
  if (stockError) {
    throw new Error(`Failed to read stock level: ${stockError.message}`);
  }

  const { data: movements, error: movementError } = await admin
    .from('inventory_movements')
    .select('quantity_delta, quantity_after, created_at')
    .eq('organization_id', orgId)
    .eq('item_id', itemId)
    .eq('location_id', locationId)
    .order('created_at', { ascending: true });
  if (movementError) {
    throw new Error(`Failed to read inventory movements: ${movementError.message}`);
  }

  const rows = movements ?? [];
  const movementTotal = rows.reduce((sum, row) => sum + Number(row.quantity_delta), 0);
  const lastQuantityAfter =
    rows.length > 0 ? Number(rows[rows.length - 1].quantity_after) : 0;

  return {
    quantityOnHand: Number(stockLevel?.quantity_on_hand ?? 0),
    movementTotal,
    lastQuantityAfter,
    movementCount: rows.length,
  };
}
