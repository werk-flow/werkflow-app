import { readOrganizationCalendar } from '@/lib/personnel/calendar-reader';
import { cache } from "react";
import { z } from "zod";
import { memoizeRequestRead } from './read-request-cache';
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";
import type { User } from "@supabase/supabase-js";
import type { UserOrg } from "@/components/organization/organization-context";
import { Constants, type Database, type Json } from "@/lib/supabase/database.types";
import {
  getAuftraegePreferencesFromJson,
  type AuftraegeColumnId,
} from "@/lib/jobs/auftraege-table-columns";
import {
  getDefaultTimeTrackingSettings,
  normalizeTimeTrackingSettings,
  parseBreakPolicyHistory,
  type OrganizationTimeTrackingSettings,
} from "@/lib/time-tracking/settings";
import {
  type OrganizationHolidayCalendar,
} from "@/lib/personnel/targets";
import { getMembershipAccessMode } from "@/lib/personnel/lifecycle";

// Tag helpers for cache invalidation in server actions
export const CACHE_TAGS = {
  memberships: (userId: string) => `memberships-${userId}`,
  subscription: (userId: string) => `subscription-${userId}`,
  profile: (userId: string) => `profile-${userId}`,
  memberCount: (orgId: string) => `member-count-${orgId}`,
  organizationSettings: (orgId: string) => `organization-settings-${orgId}`,
  organizationUserPreferences: (orgId: string, userId: string) =>
    `organization-user-preferences-${orgId}-${userId}`,
  requests: (orgId: string) => `requests-${orgId}`,
  personnel: (orgId: string) => `personnel-${orgId}`,
  vacation: (orgId: string): string => `vacation-${orgId}`,
  sickness: (orgId: string): string => `sickness-${orgId}`,
  teams: (orgId: string): string => `teams-${orgId}`,
  qualifications: (orgId: string): string => `qualifications-${orgId}`,
  responsibilities: (orgId: string) => `responsibilities-${orgId}`,
  organizationCalendar: (orgId: string) => `organization-calendar-${orgId}`,
  jobs: (orgId: string) => `jobs-${orgId}`,
  projects: (orgId: string) => `projects-${orgId}`,
  documents: (orgId: string) => `documents-${orgId}`,
  equipment: (orgId: string) => `equipment-${orgId}`,
  inventory: (orgId: string) => `inventory-${orgId}`,
  workTemplates: (orgId: string) => `work-templates-${orgId}`,
} as const;

const REVALIDATE_SECONDS = 300; // 5 minutes safety net

/**
 * Validates the JWT against Supabase Auth servers and returns the
 * authenticated User, or null when Auth rejects the identity.
 *
 * This MUST use getUser() (network roundtrip) rather than getSession()
 * because server actions use the returned user ID with the admin client
 * (which bypasses RLS). This is not proof of current organization permission
 * or immediate session revocation: issued JWTs can survive sign-out until
 * expiry. Callers must also enforce current membership and lifecycle access.
 *
 * Deduplicates in a React render or an explicit GET read-request scope.
 */
export const getAuthenticatedUser = memoizeRequestRead(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

/**
 * Page-rendering shape of the same verified identity. It delegates to
 * getAuthenticatedUser so a render that also runs Server-Action readers pays
 * one Auth round trip, not two.
 */
export async function getCachedUser(): Promise<{ data: { user: User | null } }> {
  return { data: { user: await getAuthenticatedUser() } };
}

/**
 * Membership facts must be fresh on each request. A stale candidate list can
 * overwrite a newly selected organization or retain revoked role/access facts.
 * Share the read only within a GET scope or React render.
 */
type MembershipCandidate = UserOrg & {
  hasAccessBlocker: boolean;
  accessLifecycle: {
    state: Database["public"]["Enums"]["personnel_access_state"];
    scheduledState:
      | Database["public"]["Enums"]["personnel_access_state"]
      | null;
    scheduledFor: string | null;
  } | null;
};

const membershipRowsSchema = z.array(z.object({
  organization_id: z.string(),
  role: z.enum(Constants.public.Enums.org_role),
  joined_at: z.string(),
  organizations: z.object({
    id: z.string(), name: z.string(), unique_code: z.string(),
    employee_records: z.array(z.object({
      id: z.string(), user_id: z.string(),
      personnel_access_lifecycles: z.array(z.object({
        state: z.enum(Constants.public.Enums.personnel_access_state),
        scheduled_state: z.enum(Constants.public.Enums.personnel_access_state).nullable(),
        scheduled_for: z.string().nullable(),
      })).max(1),
      personnel_onboarding_requirements: z.array(z.object({ id: z.string() })),
    })).max(1),
  }).nullable(),
}));

const loadMembershipCandidates = memoizeRequestRead(
  async (userId: string): Promise<MembershipCandidate[]> => {
    const admin = createSupabaseAdminClient();
    // One current database snapshot, with composite foreign keys keeping each
    // lifecycle/blocker attached to the employee in this organization.
    const { data, error } = await admin.from("organization_members").select(`
      organization_id, role, joined_at,
      organizations (id, name, unique_code,
        employee_records (id, user_id,
          personnel_access_lifecycles!personnel_access_lifecycles_employee_org_fkey (state, scheduled_state, scheduled_for),
          personnel_onboarding_requirements!personnel_onboarding_requirements_employee_org_fkey (id)
        )
      )
    `)
      .eq("user_id", userId)
      .eq("organizations.employee_records.user_id", userId)
      .eq("organizations.employee_records.personnel_onboarding_requirements.blocks_access", true)
      .not("organizations.employee_records.personnel_onboarding_requirements.state", "in", "(fulfilled,waived,cancelled)")
      // Only blocker existence matters; fetching its full history is unnecessary.
      .limit(1, { referencedTable: "organizations.employee_records.personnel_onboarding_requirements" });
    if (error) throw error;
    const memberships = membershipRowsSchema.parse(data);
    return memberships.flatMap((membership) => {
      const organization = membership.organizations;
      if (!organization) return [];
      const employee = organization.employee_records[0];
      if (organization.id !== membership.organization_id || (employee && employee.user_id !== userId)) {
        throw new Error("Membership response crossed its requested scope");
      }
      const lifecycle = employee?.personnel_access_lifecycles[0];
      return [{
        orgId: organization.id, name: organization.name, uniqueCode: organization.unique_code,
        role: membership.role, joinedAt: membership.joined_at,
        hasAccessBlocker: (employee?.personnel_onboarding_requirements.length ?? 0) > 0,
        accessLifecycle: lifecycle ? {
          state: lifecycle.state, scheduledState: lifecycle.scheduled_state, scheduledFor: lifecycle.scheduled_for,
        } : null,
      }];
    });
  },
);

function toUserOrg(membership: MembershipCandidate): UserOrg {
  return {
    orgId: membership.orgId,
    name: membership.name,
    uniqueCode: membership.uniqueCode,
    role: membership.role,
    joinedAt: membership.joinedAt,
  };
}

export const getCachedMemberships = memoizeRequestRead(
  async (userId: string): Promise<UserOrg[]> => {
    const candidates = await loadMembershipCandidates(userId);
    const now = Date.now();
    return candidates
      .filter((membership) => getMembershipAccessMode(membership, now) === "operational")
      .map(toUserOrg);
  },
);

export const getCachedPrestartMemberships = memoizeRequestRead(
  async (userId: string): Promise<UserOrg[]> => {
    const candidates = await loadMembershipCandidates(userId);
    const now = Date.now();
    return candidates
      .filter((membership) => getMembershipAccessMode(membership, now) === "prestart")
      .map(toUserOrg);
  },
);

/**
 * Cross-request cached subscription status.
 */
export const getCachedSubscriptionStatus = cache(
  async (userId: string): Promise<boolean> => {
    const fetchSubscription = unstable_cache(
      async (uid: string): Promise<boolean> => {
        const admin = createSupabaseAdminClient();

        const { data, error } = await admin
          .from("subscriptions")
          .select("status")
          .eq("user_id", uid)
          .single();

        if (error) {
          if (error.code === "PGRST116") {
            return false;
          }
          console.error("Error fetching subscription:", error);
          return false;
        }

        return data?.status === "active";
      },
      [`subscription-${userId}`],
      {
        tags: [CACHE_TAGS.subscription(userId)],
        revalidate: REVALIDATE_SECONDS,
      },
    );

    return fetchSubscription(userId);
  },
);

/**
 * Cross-request cached member count.
 */
export const getCachedMemberCount = cache(
  async (orgId: string): Promise<number | null> => {
    const fetchMemberCount = unstable_cache(
      async (oid: string): Promise<number | null> => {
        const admin = createSupabaseAdminClient();

        const { count, error } = await admin
          .from("organization_members")
          .select("*", { count: "exact", head: true })
          .eq("organization_id", oid);

        if (error) {
          console.error("Error fetching member count:", error);
          return null;
        }

        return count;
      },
      [`member-count-${orgId}`],
      { tags: [CACHE_TAGS.memberCount(orgId)], revalidate: REVALIDATE_SECONDS },
    );

    return fetchMemberCount(orgId);
  },
);

export const getCachedOrganizationSettings = cache(
  async (orgId: string): Promise<OrganizationTimeTrackingSettings> => {
    const fetchOrganizationSettings = unstable_cache(
      async (oid: string): Promise<OrganizationTimeTrackingSettings> => {
        const admin = createSupabaseAdminClient();

        const { data, error } = await admin
          .from("organization_settings")
          .select(
            "organization_id, break_mode, auto_break_threshold_minutes, auto_break_duration_minutes, break_policy_history",
          )
          .eq("organization_id", oid)
          .maybeSingle();

        if (error) {
          console.error("Error fetching organization settings:", error);
          return getDefaultTimeTrackingSettings(oid);
        }

        if (!data) {
          return getDefaultTimeTrackingSettings(oid);
        }

        return normalizeTimeTrackingSettings({
          organizationId: data.organization_id,
          breakMode: data.break_mode,
          autoBreakThresholdMinutes: data.auto_break_threshold_minutes,
          autoBreakDurationMinutes: data.auto_break_duration_minutes,
          breakPolicyHistory: parseBreakPolicyHistory(
            data.break_policy_history,
          ),
        });
      },
      [`organization-settings-${orgId}`],
      {
        tags: [CACHE_TAGS.organizationSettings(orgId)],
        revalidate: REVALIDATE_SECONDS,
      },
    );

    return fetchOrganizationSettings(orgId);
  },
);

/**
 * Cross-request cached holiday/closure context (P1-04): the selected holiday
 * region with its effective-from history plus the organization's closure days.
 * Tagged with both the settings tag (region lives on organization_settings)
 * and its own calendar tag (closure-day mutations).
 */
export const getCachedOrganizationCalendar = cache(
  async (orgId: string): Promise<OrganizationHolidayCalendar> => {
    const fetchCalendar = unstable_cache(
      (oid: string) => readOrganizationCalendar(oid),
      [`organization-calendar-${orgId}`],
      {
        tags: [
          CACHE_TAGS.organizationSettings(orgId),
          CACHE_TAGS.organizationCalendar(orgId),
        ],
        revalidate: REVALIDATE_SECONDS,
      },
    );

    return fetchCalendar(orgId);
  },
);

export const getCachedOrganizationUserPreferences = cache(
  async (
    orgId: string,
    userId: string,
  ): Promise<{
    visibleColumns: AuftraegeColumnId[];
    preferences: Json | null;
  }> => {
    const fetchPreferences = unstable_cache(
      async (
        oid: string,
        uid: string,
      ): Promise<{
        visibleColumns: AuftraegeColumnId[];
        preferences: Json | null;
      }> => {
        const admin = createSupabaseAdminClient();

        const { data, error } = await admin
          .from("organization_user_preferences")
          .select("preferences")
          .eq("organization_id", oid)
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          console.error("Error fetching organization user preferences:", error);
          return {
            visibleColumns: getAuftraegePreferencesFromJson(null),
            preferences: null,
          };
        }

        return {
          visibleColumns: getAuftraegePreferencesFromJson(
            data?.preferences ?? null,
          ),
          preferences: data?.preferences ?? null,
        };
      },
      [`organization-user-preferences-${orgId}-${userId}`],
      {
        tags: [CACHE_TAGS.organizationUserPreferences(orgId, userId)],
        revalidate: REVALIDATE_SECONDS,
      },
    );

    return fetchPreferences(orgId, userId);
  },
);

export type UserProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarPath: string | null;
  avatarUrl: string | null;
};

/**
 * Cross-request cached user profile.
 * Email is passed in since it comes from auth.users.
 */
export const getCachedUserProfile = cache(
  async (userId: string, email: string): Promise<UserProfile | null> => {
    const fetchProfile = unstable_cache(
      async (uid: string, em: string): Promise<UserProfile | null> => {
        const admin = createSupabaseAdminClient();

        const { data, error } = await admin
          .from("profiles")
          .select("id, first_name, last_name, avatar_path")
          .eq("id", uid)
          .single();

        if (error) {
          console.error("Error fetching user profile:", error);
          return null;
        }

        return {
          id: data.id,
          firstName: data.first_name,
          lastName: data.last_name,
          email: em,
          avatarPath: data.avatar_path,
          avatarUrl: getProfileAvatarUrl(data.avatar_path),
        };
      },
      [`profile-${userId}`],
      { tags: [CACHE_TAGS.profile(userId)], revalidate: REVALIDATE_SECONDS },
    );

    return fetchProfile(userId, email);
  },
);
