import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getProfileAvatarUrl } from "@/lib/profile-avatar";
import type { User } from "@supabase/supabase-js";
import type { UserOrg } from "@/components/organization/organization-context";
import type { Database, Json } from "@/lib/supabase/database.types";
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
  parseHolidayRegionHistory,
  type OrganizationHolidayCalendar,
} from "@/lib/personnel/targets";
import { getMembershipAccessMode } from "@/lib/personnel/lifecycle";

type OrganizationData = {
  id: string;
  name: string;
  unique_code: string;
};

// Tag helpers for cache invalidation in server actions
export const CACHE_TAGS = {
  memberships: (userId: string) => `memberships-${userId}`,
  subscription: (userId: string) => `subscription-${userId}`,
  profile: (userId: string) => `profile-${userId}`,
  memberCount: (orgId: string) => `member-count-${orgId}`,
  organizationSettings: (orgId: string) => `organization-settings-${orgId}`,
  organizationUserPreferences: (orgId: string, userId: string) =>
    `organization-user-preferences-${orgId}-${userId}`,
  clients: (orgId: string) => `clients-${orgId}`,
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
 * Cached user fetch for page rendering — deduplicates within a single
 * request via React cache(). Uses getUser() which validates the JWT
 * against Supabase Auth servers (one network roundtrip per request).
 */
export const getCachedUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return {
    data: { user: user ?? null },
    error,
  };
});

/**
 * Validates the JWT against Supabase Auth servers and returns the
 * authenticated User, or null if the token is invalid/expired/revoked.
 *
 * This MUST use getUser() (network roundtrip) rather than getSession()
 * because server actions use the returned user ID with the admin client
 * (which bypasses RLS). Without server-side validation, a revoked or
 * banned user with an unexpired JWT could still execute privileged
 * operations.
 *
 * Deduplicates within a single request via React cache().
 */
export const getAuthenticatedUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
});

/**
 * Cross-request cached memberships fetch.
 * Uses unstable_cache with the admin client (no cookies needed) so results
 * persist across navigations. Tagged for on-demand revalidation.
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

async function loadMembershipCandidates(userId: string): Promise<MembershipCandidate[]> {
  const fetchMemberships = unstable_cache(
    async (uid: string): Promise<MembershipCandidate[]> => {
      const admin = createSupabaseAdminClient();
      const [membersResult, employeesResult] = await Promise.all([
        admin
          .from("organization_members")
          .select(
            `organization_id, role, joined_at, organizations (id, name, unique_code)`,
          )
          .eq("user_id", uid),
        admin
          .from("employee_records")
          .select("id, organization_id")
          .eq("user_id", uid),
      ]);

      if (membersResult.error || employeesResult.error) {
        console.error(
          "Error fetching memberships:",
          membersResult.error ?? employeesResult.error,
        );
        throw membersResult.error ?? employeesResult.error;
      }

      const employeeByOrganization = new Map(
        (employeesResult.data ?? []).map((employee) => [
          employee.organization_id,
          employee.id,
        ]),
      );
      const employeeIds = Array.from(employeeByOrganization.values());
      const organizationIds = Array.from(employeeByOrganization.keys());
      const organizationByEmployee = new Map(
        Array.from(employeeByOrganization, ([organizationId, employeeId]) => [
          employeeId,
          organizationId,
        ]),
      );
      const [lifecyclesResult, blockersResult] = await Promise.all([
        employeeIds.length > 0
          ? admin
              .from("personnel_access_lifecycles")
              .select("employee_record_id, organization_id, state, scheduled_state, scheduled_for")
              .in("employee_record_id", employeeIds)
              .in("organization_id", organizationIds)
          : Promise.resolve({ data: [], error: null }),
        employeeIds.length > 0
          ? admin
              .from("personnel_onboarding_requirements")
              .select("employee_record_id, organization_id")
              .in("employee_record_id", employeeIds)
              .in("organization_id", organizationIds)
              .eq("blocks_access", true)
              .not("state", "in", "(fulfilled,waived,cancelled)")
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (lifecyclesResult.error || blockersResult.error) {
        console.error(
          "Error fetching membership access state:",
          lifecyclesResult.error ?? blockersResult.error,
        );
        throw lifecyclesResult.error ?? blockersResult.error;
      }
      const lifecycleByEmployee = new Map(
        (lifecyclesResult.data ?? [])
          .filter(
            (lifecycle) =>
              organizationByEmployee.get(lifecycle.employee_record_id) ===
              lifecycle.organization_id,
          )
          .map((lifecycle) => [
            lifecycle.employee_record_id,
            {
              state: lifecycle.state,
              scheduledState: lifecycle.scheduled_state,
              scheduledFor: lifecycle.scheduled_for,
            },
          ]),
      );
      const blockedEmployeeIds = new Set(
        (blockersResult.data ?? [])
          .filter(
            (requirement) =>
              organizationByEmployee.get(requirement.employee_record_id) ===
              requirement.organization_id,
          )
          .map((requirement) => requirement.employee_record_id),
      );

      return (membersResult.data ?? [])
        .filter((membership) => membership.organizations !== null)
        .map((membership) => {
          const organization = membership.organizations as unknown as OrganizationData;
          const employeeId = employeeByOrganization.get(membership.organization_id);
          return {
            orgId: membership.organization_id,
            name: organization.name,
            uniqueCode: organization.unique_code,
            role: membership.role,
            joinedAt: membership.joined_at,
            hasAccessBlocker: employeeId
              ? blockedEmployeeIds.has(employeeId)
              : false,
            accessLifecycle: employeeId
              ? (lifecycleByEmployee.get(employeeId) ?? null)
              : null,
          };
        });
    },
    [`memberships-${userId}`],
    {
      tags: [CACHE_TAGS.memberships(userId)],
      revalidate: REVALIDATE_SECONDS,
    },
  );

  return fetchMemberships(userId);
}

function toUserOrg(membership: MembershipCandidate): UserOrg {
  return {
    orgId: membership.orgId,
    name: membership.name,
    uniqueCode: membership.uniqueCode,
    role: membership.role,
    joinedAt: membership.joinedAt,
  };
}

export const getCachedMemberships = cache(
  async (userId: string): Promise<UserOrg[]> => {
    const candidates = await loadMembershipCandidates(userId);
    const now = Date.now();
    return candidates
      .filter((membership) => getMembershipAccessMode(membership, now) === "operational")
      .map(toUserOrg);
  },
);

export const getCachedPrestartMemberships = cache(
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
      async (oid: string): Promise<OrganizationHolidayCalendar> => {
        const admin = createSupabaseAdminClient();

        const [settingsResult, closureResult] = await Promise.all([
          admin
            .from("organization_settings")
            .select("holiday_region, holiday_region_history")
            .eq("organization_id", oid)
            .maybeSingle(),
          admin
            .from("organization_closure_days")
            .select("id, closure_date, label")
            .eq("organization_id", oid)
            .order("closure_date", { ascending: true }),
        ]);

        if (settingsResult.error) {
          console.error(
            "Error fetching organization holiday settings:",
            settingsResult.error,
          );
        }
        if (closureResult.error) {
          console.error(
            "Error fetching organization closure days:",
            closureResult.error,
          );
        }

        return {
          holidayRegion: settingsResult.data?.holiday_region ?? null,
          holidayRegionHistory: parseHolidayRegionHistory(
            settingsResult.data?.holiday_region_history,
          ),
          closureDays: (closureResult.data ?? []).map((row) => ({
            id: row.id,
            closureDate: row.closure_date,
            label: row.label,
          })),
        };
      },
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
