import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from './env';
import type { TestRole, TestUser, TestWorld } from './world';
import {
  deleteStorageObjects,
  listStorageObjectPaths,
} from '../../../lib/storage/r2';

const ORGANIZATION_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function createAdminClient(): SupabaseClient {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function listTestUserIds(admin: SupabaseClient): Promise<string[]> {
  // The sb_secret keys are exchanged for a gateway-minted JWT per request;
  // Supabase-side clock skew between nodes intermittently rejects one with
  // "JWT issued at future" (environment class, observed 2026-08-21 killing
  // global setup twice). A bounded retry rides over the skewed node.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt += 1) {
    const [goldenDomainResult, resendResult] = await Promise.all([
      admin.from('profiles').select('id').like('email', '%@werkflow-golden.test'),
      admin.from('profiles').select('id').like('email', 'delivered+gg-%@resend.dev'),
    ]);
    const error = goldenDomainResult.error ?? resendResult.error;
    if (!error) {
      return [
        ...new Set(
          [...(goldenDomainResult.data ?? []), ...(resendResult.data ?? [])].map(
            (profile) => profile.id as string
          )
        ),
      ];
    }
    if (attempt >= MAX_ATTEMPTS || !error.message.includes('JWT')) {
      throw new Error(`Test user lookup failed: ${error.message}`);
    }
    console.warn(
      `[golden] transient auth error during leftover sweep (attempt ${attempt}/${MAX_ATTEMPTS}): ${error.message}`
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// Mailbox stand-in for UI signup tests. The production flow requires the user
// to follow an email link; the disposable harness confirms only unmistakable
// golden-test addresses and leaves organization creation to the real UI.
export async function confirmTestUserEmail(email: string): Promise<void> {
  if (!email.endsWith('@werkflow-golden.test')) {
    throw new Error(`Refusing to confirm non-test address: ${email}`);
  }
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .single();
  if (profileError || !profile) {
    throw new Error(`Signup profile not found for ${email}: ${profileError?.message}`);
  }
  const { error } = await admin.auth.admin.updateUserById(profile.id, {
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to confirm ${email}: ${error.message}`);
}

function randomOrgCode(): string {
  let code = '';
  for (let index = 0; index < 6; index++) {
    code += ORGANIZATION_CODE_CHARSET.charAt(
      Math.floor(Math.random() * ORGANIZATION_CODE_CHARSET.length)
    );
  }
  return code;
}

async function createTestUser(
  admin: SupabaseClient,
  runId: string,
  role: string,
  firstName: string,
  lastName: string,
  emailOverride?: string
): Promise<TestUser> {
  const email = emailOverride ?? `gg-${role}-${runId}@werkflow-golden.test`;
  const password = `GgTest!${runId}#2026`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  if (error || !data.user) {
    throw new Error(`Failed to create test user ${email}: ${error?.message}`);
  }

  // The handle_new_user trigger creates the profile row; make the display
  // name deterministic regardless of what the trigger maps from metadata.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ first_name: firstName, last_name: lastName })
    .eq('id', data.user.id);

  if (profileError) {
    throw new Error(`Failed to set profile name for ${email}: ${profileError.message}`);
  }

  return { id: data.user.id, email, password, firstName, lastName };
}

async function createOrganizationWithSettings(
  admin: SupabaseClient,
  name: string,
  adminUserId: string
): Promise<string> {
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name, admin_id: adminUserId, unique_code: randomOrgCode() })
    .select('id, created_at')
    .single();

  if (orgError || !org) {
    throw new Error(`Failed to create test organization ${name}: ${orgError?.message}`);
  }

  // Mirrors lib/org/actions.ts createOrganization defaults.
  const { error: settingsError } = await admin.from('organization_settings').insert({
    organization_id: org.id,
    break_mode: 'manual',
    auto_break_threshold_minutes: 360,
    auto_break_duration_minutes: 30,
    break_policy_history: [
      {
        breakMode: 'manual',
        autoBreakThresholdMinutes: 360,
        autoBreakDurationMinutes: 30,
        effectiveFrom: org.created_at,
      },
    ],
  });

  if (settingsError) {
    throw new Error(`Failed to create organization settings: ${settingsError.message}`);
  }

  return org.id as string;
}

// Seeds inventory master data plus opening stock. Stock enters through the
// same record_inventory_movement RPC the product uses, so the movement ledger
// and inventory_stock_levels are consistent from the first row on.
async function seedInventory(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  runId: string
): Promise<TestWorld['inventory']> {
  const locationName = 'Hauptlager (Golden)';
  const itemName = `Kupferrohr 15 mm ${runId}`;
  const initialQuantity = 20;

  const { data: location, error: locationError } = await admin
    .from('inventory_locations')
    .insert({
      organization_id: orgId,
      name: locationName,
      location_type: 'storage',
      created_by: actorId,
    })
    .select('id')
    .single();
  if (locationError || !location) {
    throw new Error(`Failed to seed inventory location: ${locationError?.message}`);
  }

  const { data: item, error: itemError } = await admin
    .from('inventory_items')
    .insert({
      organization_id: orgId,
      name: itemName,
      item_type: 'material',
      unit: 'piece',
      created_by: actorId,
    })
    .select('id')
    .single();
  if (itemError || !item) {
    throw new Error(`Failed to seed inventory item: ${itemError?.message}`);
  }

  const { error: movementError } = await admin.rpc('record_inventory_movement', {
    p_organization_id: orgId,
    p_actor_id: actorId,
    p_item_id: item.id,
    p_location_id: location.id,
    p_movement_type: 'initial_count',
    p_quantity_delta: initialQuantity,
    p_job_id: null,
    p_project_id: null,
    p_job_material_line_id: null,
    p_import_batch_id: null,
    p_reason: 'Golden-Gate Startbestand',
  });
  if (movementError) {
    throw new Error(`Failed to seed inventory stock: ${movementError.message}`);
  }

  return {
    itemId: item.id as string,
    itemName,
    locationId: location.id as string,
    locationName,
    initialQuantity,
  };
}

export async function createTestWorld(): Promise<TestWorld> {
  const admin = createAdminClient();
  const runId = Date.now().toString(36);

  const users: Record<TestRole, TestUser> = {
    admin: await createTestUser(admin, runId, 'admin', 'Greta', `Golden-${runId}`),
    buero: await createTestUser(admin, runId, 'buero', 'Bruno', `Golden-${runId}`),
    employee: await createTestUser(admin, runId, 'employee', 'Emil', `Golden-${runId}`),
  };
  const outsiderAdmin = await createTestUser(admin, runId, 'outsider', 'Otto', `Fremd-${runId}`);
  // The invitee joins during the gate via the real invite flow. Resend's
  // delivered+label@resend.dev test address accepts mail without bouncing, so
  // the gate does not damage sender reputation on every run.
  const invitee = await createTestUser(
    admin,
    runId,
    'invitee',
    'Ida',
    `Golden-${runId}`,
    `delivered+gg-${runId}@resend.dev`
  );
  // P1-03 fixtures: a member the personnel spec removes, and a future login
  // for a personnel record without access. The invite email address reuses the
  // delivered+gg- prefix so the leftover cleaner keeps matching it.
  const removableEmployee = await createTestUser(
    admin,
    runId,
    'removable',
    'Rudi',
    `Golden-${runId}`
  );
  const personnelInvitee = await createTestUser(
    admin,
    runId,
    'personnel-invitee',
    'Nora',
    `Neuling-${runId}`,
    `delivered+gg-p103-${runId}@resend.dev`
  );

  // Organization creation is subscription-gated in the product UI; seeded
  // admins get an active subscription row so admin-gated surfaces behave.
  for (const userId of [users.admin.id, outsiderAdmin.id]) {
    const { error } = await admin
      .from('subscriptions')
      .insert({ user_id: userId, status: 'active', plan_id: 'golden-test' });
    if (error) {
      throw new Error(`Failed to insert test subscription: ${error.message}`);
    }
  }

  const orgName = `Golden Test SHK ${runId}`;
  const orgId = await createOrganizationWithSettings(admin, orgName, users.admin.id);
  // The add_admin_membership trigger creates the admin membership; add the rest.
  for (const [role, user] of [
    ['buero', users.buero],
    ['employee', users.employee],
    ['employee', removableEmployee],
  ] as const) {
    const { error } = await admin
      .from('organization_members')
      .insert({ organization_id: orgId, user_id: user.id, role });
    if (error) {
      throw new Error(`Failed to add ${role} membership: ${error.message}`);
    }
  }

  const outsiderOrgName = `Fremde Firma ${runId}`;
  const outsiderOrgId = await createOrganizationWithSettings(
    admin,
    outsiderOrgName,
    outsiderAdmin.id
  );

  const inventory = await seedInventory(admin, orgId, users.admin.id, runId);

  return {
    runId,
    orgId,
    orgName,
    users,
    invitee,
    removableEmployee,
    personnelInvitee,
    inventory,
    outsider: { orgId: outsiderOrgId, orgName: outsiderOrgName, admin: outsiderAdmin },
  };
}

export async function destroyTestWorld(world: TestWorld): Promise<void> {
  const admin = createAdminClient();
  const failures: string[] = [];

  const users = [
    world.users.admin,
    world.users.buero,
    world.users.employee,
    world.invitee,
    world.removableEmployee,
    world.personnelInvitee,
    world.outsider.admin,
  ];
  const userIds = users.map((user) => user.id);
  const { data: ownedTestOrganizations, error: ownedOrganizationsError } = await admin
    .from('organizations')
    .select('id')
    .in('admin_id', userIds)
    .or('name.like.Golden Test SHK %,name.like.Fremde Firma %');
  if (ownedOrganizationsError) {
    failures.push(`owned test organization lookup: ${ownedOrganizationsError.message}`);
  }
  const organizationIds = [
    ...new Set([
      world.orgId,
      world.outsider.orgId,
      ...(ownedTestOrganizations ?? []).map((organization) => organization.id as string),
    ]),
  ];

  // Remove uploaded file bytes for both test orgs (metadata cascades with the
  // organization rows, but R2 objects would otherwise linger).
  for (const orgId of organizationIds) {
    try {
      const paths = await listStorageObjectPaths(`${orgId}/`);
      await deleteStorageObjects(paths);
    } catch (error) {
      failures.push(`R2 cleanup for ${orgId}: ${(error as Error).message}`);
    }
  }

  // Clear selected-responsibility configurations first: on partially
  // torn-down worlds the cascaded member deletes would otherwise trip
  // app_private.protect_last_selected_responsibility_holder.
  const { error: responsibilityConfigError } = await admin
    .from('organization_responsibility_configurations')
    .delete()
    .in('organization_id', organizationIds);
  if (responsibilityConfigError) {
    failures.push(`responsibility configuration delete: ${responsibilityConfigError.message}`);
  }

  // Every org-scoped table cascades from organizations (verified 2026-08-04).
  const { error: orgDeleteError } = await admin
    .from('organizations')
    .delete()
    .in('id', organizationIds);
  if (orgDeleteError) {
    failures.push(`organization delete: ${orgDeleteError.message}`);
  }

  const { error: subscriptionError } = await admin
    .from('subscriptions')
    .delete()
    .in('user_id', userIds);
  if (subscriptionError) {
    failures.push(`subscription delete: ${subscriptionError.message}`);
  }

  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    // An already-deleted user is the expected state after an interrupted
    // earlier teardown, not a cleanup failure.
    if (error && !/user not found/i.test(error.message)) {
      failures.push(`auth user delete ${userId}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Test world cleanup incomplete:\n${failures.join('\n')}`);
  }
}

// Safety valve: remove leftover worlds from crashed runs. Only touches
// organizations whose name matches the unmistakable test prefix.
export async function destroyLeftoverTestWorlds(): Promise<number> {
  const admin = createAdminClient();

  // Resolve users before deleting auth-owned profile rows.
  const testUserIds = await listTestUserIds(admin);

  const { data: leftoverOrgs } = await admin
    .from('organizations')
    .select('id')
    .or('name.like.Golden Test SHK %,name.like.Fremde Firma %');

  const orgIds = (leftoverOrgs ?? []).map((org) => org.id as string);
  for (const orgId of orgIds) {
    try {
      const paths = await listStorageObjectPaths(`${orgId}/`);
      await deleteStorageObjects(paths);
    } catch {
      // Bytes may already be gone; org deletion below is what matters.
    }
  }
  if (orgIds.length > 0) {
    // Same ordering as destroyTestWorld: clear selected-responsibility
    // configurations so protect_last_selected_responsibility_holder cannot
    // block the cascaded member deletes of a partially torn-down world.
    const { error: configError } = await admin
      .from('organization_responsibility_configurations')
      .delete()
      .in('organization_id', orgIds);
    if (configError) {
      throw new Error(`Leftover responsibility cleanup failed: ${configError.message}`);
    }
    const { error } = await admin.from('organizations').delete().in('id', orgIds);
    if (error) {
      throw new Error(`Leftover organization cleanup failed: ${error.message}`);
    }
  }

  let removedUsers = 0;
  const failures: string[] = [];
  for (const userId of testUserIds) {
    const { error: subscriptionError } = await admin
      .from('subscriptions')
      .delete()
      .eq('user_id', userId);
    const { error: authError } = await admin.auth.admin.deleteUser(userId);

    if (subscriptionError) {
      failures.push(
        `subscription delete ${userId}: ${subscriptionError.message}`
      );
    }
    if (authError && !/user not found/i.test(authError.message)) {
      failures.push(`auth user delete ${userId}: ${authError.message}`);
    }
    if (!subscriptionError && !authError) removedUsers++;
  }

  if (failures.length > 0) {
    throw new Error(`Leftover test cleanup incomplete:\n${failures.join('\n')}`);
  }

  return orgIds.length + removedUsers;
}
