import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

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
  lastName: string
): Promise<TestUser> {
  const email = `gg-${role}-${runId}@werkflow-golden.test`;
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

export async function createTestWorld(): Promise<TestWorld> {
  const admin = createAdminClient();
  const runId = Date.now().toString(36);

  const users: Record<TestRole, TestUser> = {
    admin: await createTestUser(admin, runId, 'admin', 'Greta', `Golden-${runId}`),
    buero: await createTestUser(admin, runId, 'buero', 'Bruno', `Golden-${runId}`),
    employee: await createTestUser(admin, runId, 'employee', 'Emil', `Golden-${runId}`),
  };
  const outsiderAdmin = await createTestUser(admin, runId, 'outsider', 'Otto', `Fremd-${runId}`);

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

  return {
    runId,
    orgId,
    orgName,
    users,
    outsider: { orgId: outsiderOrgId, orgName: outsiderOrgName, admin: outsiderAdmin },
  };
}

export async function destroyTestWorld(world: TestWorld): Promise<void> {
  const admin = createAdminClient();
  const failures: string[] = [];

  // Remove uploaded file bytes for both test orgs (metadata cascades with the
  // organization rows, but R2 objects would otherwise linger).
  for (const orgId of [world.orgId, world.outsider.orgId]) {
    try {
      const paths = await listStorageObjectPaths(`${orgId}/`);
      await deleteStorageObjects(paths);
    } catch (error) {
      failures.push(`R2 cleanup for ${orgId}: ${(error as Error).message}`);
    }
  }

  // Every org-scoped table cascades from organizations (verified 2026-08-04).
  const { error: orgDeleteError } = await admin
    .from('organizations')
    .delete()
    .in('id', [world.orgId, world.outsider.orgId]);
  if (orgDeleteError) {
    failures.push(`organization delete: ${orgDeleteError.message}`);
  }

  const allUsers = [
    world.users.admin,
    world.users.buero,
    world.users.employee,
    world.outsider.admin,
  ];

  const { error: subscriptionError } = await admin
    .from('subscriptions')
    .delete()
    .in(
      'user_id',
      allUsers.map((user) => user.id)
    );
  if (subscriptionError) {
    failures.push(`subscription delete: ${subscriptionError.message}`);
  }

  for (const user of allUsers) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      failures.push(`auth user delete ${user.email}: ${error.message}`);
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
    await admin.from('organizations').delete().in('id', orgIds);
  }

  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let removedUsers = 0;
  for (const user of userList?.users ?? []) {
    if (user.email?.endsWith('@werkflow-golden.test')) {
      await admin.from('subscriptions').delete().eq('user_id', user.id);
      await admin.auth.admin.deleteUser(user.id);
      removedUsers++;
    }
  }

  return orgIds.length + removedUsers;
}
