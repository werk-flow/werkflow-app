import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { requireEnv } from './env';
import { testSupabaseClientOptions } from './client-options';
import type { TestUser, TestWorld } from './world';
import { registerTestUserEmail } from './world';
import { planTestWorld, seedOwnedWorld } from '../../../lib/testing/seed-world-plan';
import { ownedTestEmails } from '../../../lib/testing/test-email-ownership';
import { deleteOwnedMailpitMessages, localMailpitUrl } from '../../../lib/testing/local-mailpit';
import {
  deleteStorageObjects,
  listStorageObjectPaths,
} from '../../../lib/storage/r2';

const ORGANIZATION_CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Reserve exact cleanup identity before returning an address that a browser can submit.
export function goldenTestEmail(label: string, runId: string): string {
  return registerTestUserEmail(label, runId);
}

export function goldenTestOrganizationName(label: string, runId: string): string {
  return `Golden Test SHK ${label} ${runId}`;
}

function createAdminClient(): SupabaseClient {
  return createClient(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SECRET_KEY'), testSupabaseClientOptions);
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

async function createTestUser(admin: SupabaseClient, user: TestUser): Promise<void> {
  const { id, email, password, firstName, lastName } = user;

  const { data, error } = await admin.auth.admin.createUser({
    id,
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

}

async function createOrganizationWithSettings(
  admin: SupabaseClient,
  organizationId: string,
  name: string,
  adminUserId: string
): Promise<void> {
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ id: organizationId, name, admin_id: adminUserId, unique_code: randomOrgCode() })
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

}

// Seeds inventory master data plus opening stock. Stock enters through the
// same record_inventory_movement RPC the product uses, so the movement ledger
// and inventory_stock_levels are consistent from the first row on.
async function seedInventory(
  admin: SupabaseClient,
  orgId: string,
  actorId: string,
  inventory: TestWorld['inventory']
): Promise<void> {
  const { locationId, locationName, itemId, itemName, initialQuantity } = inventory;

  const { data: location, error: locationError } = await admin
    .from('inventory_locations')
    .insert({
      id: locationId,
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
      id: itemId,
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

}

export async function createTestWorld(
  recordOwnership: (world: TestWorld) => void | Promise<void>,
): Promise<TestWorld> {
  return seedOwnedWorld({
    world: planTestWorld(),
    recordOwnership,
    createResources: async (world) => {
      const admin = createAdminClient();
      // IDs and test emails are durably owned before requests, including a lost create response.
      for (const user of [
        ...Object.values(world.users),
        world.outsider.admin,
        world.invitee,
        world.removableEmployee,
        world.personnelInvitee,
      ]) {
        await createTestUser(admin, user);
      }

      // Seed only the subscription prerequisite. Browser journeys still exercise their own business writes.
      for (const userId of [world.users.admin.id, world.outsider.admin.id]) {
        const { error } = await admin
          .from('subscriptions')
          .insert({ user_id: userId, status: 'active', plan_id: 'golden-test' });
        if (error) throw new Error(`Failed to insert test subscription: ${error.message}`);
      }

      await createOrganizationWithSettings(admin, world.orgId, world.orgName, world.users.admin.id);
      for (const [role, user] of [
        ['buero', world.users.buero],
        ['employee', world.users.employee],
        ['employee', world.removableEmployee],
      ] as const) {
        const { error } = await admin
          .from('organization_members')
          .insert({ organization_id: world.orgId, user_id: user.id, role });
        if (error) throw new Error(`Failed to add ${role} membership: ${error.message}`);
      }
      await createOrganizationWithSettings(admin, world.outsider.orgId, world.outsider.orgName, world.outsider.admin.id);
      await seedInventory(admin, world.orgId, world.users.admin.id, world.inventory);
    },
  });
}

export function worldUserIds(world: TestWorld): string[] {
  return [
    ...Object.values(world.users).map((user) => user.id),
    world.invitee.id,
    world.removableEmployee.id,
    world.personnelInvitee.id,
    world.outsider.admin.id,
  ];
}

export async function destroyTestWorld(world: TestWorld): Promise<void> {
  const admin = createAdminClient();
  const failures: string[] = [];

  const additionalEmails = ownedTestEmails(world);
  const mailbox = localMailpitUrl(requireEnv('NEXT_PUBLIC_SUPABASE_URL'));
  if (mailbox) {
    const emails = [
      ...Object.values(world.users).map((user) => user.email), world.invitee.email,
      world.removableEmployee.email, world.personnelInvitee.email, world.outsider.admin.email,
      ...additionalEmails,
    ];
    const suffix = `-${world.runId}@werkflow-golden.test`;
    const ownedRecipients = emails.filter((email) => email.endsWith(suffix) ||
      email === `delivered+gg-${world.runId}@resend.dev` || email === `delivered+gg-p103-${world.runId}@resend.dev`);
    if (ownedRecipients.length !== emails.length) {
      failures.push('A Mailpit cleanup recipient does not belong to this test world');
    }
    try {
      await deleteOwnedMailpitMessages(mailbox, ownedRecipients);
    } catch (error) {
      failures.push(`owned local mailbox cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  let additionalUserIds: string[] = [];
  if (additionalEmails.length) {
    const { data: profiles, error } = await admin.from('profiles').select('id').in('email', additionalEmails);
    if (error) throw new Error(`Owned signup-user lookup failed: ${error.message}`);
    // A contact-only address or rejected signup has no Auth profile and owns no extra user.
    additionalUserIds = (profiles ?? []).map((profile) => profile.id as string);
  }
  const userIds = [...new Set([...worldUserIds(world), ...additionalUserIds])];
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
