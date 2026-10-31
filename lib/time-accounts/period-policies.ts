import 'server-only';

// P1-23 period policies: the time-account policy version in force for each
// employee on each day of a period, with its credit, supplement and warning rules.

import { type AdminClient, createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  getDateRange,
  PERIOD_SOURCE_ROW_CAP,
  type PeriodPolicies,
  requirePeriodRows,
} from './period-sources';
import type { TimeAccountPolicy, TimeCreditPercentage, TimeCreditRule } from './types';
import { requirePresent } from './validation';

type PolicyAssignmentRow = Pick<
  Tables<'time_account_policy_assignments'>,
  'employee_record_id' | 'policy_id' | 'valid_from' | 'valid_until'
>;
type PolicyVersionRow = Tables<'time_account_policy_versions'>;
type PolicyVersionRules = {
  credits: Tables<'time_account_policy_credit_rules'>[];
  supplements: Tables<'time_account_policy_supplement_rules'>[];
  warnings: Tables<'time_account_policy_warning_rules'>[];
};

function emptyPolicyCalendar(
  employeeRecordIds: readonly string[],
  periodStart: string,
  periodEnd: string,
): Map<string, PeriodPolicies> {
  return new Map(
    employeeRecordIds.map((id) => [
      id,
      new Map(getDateRange(periodStart, periodEnd).map((date) => [date, null])),
    ]),
  );
}

function readPolicyAssignments(
  admin: AdminClient,
  organizationId: string,
  period: { start: string; end: string },
  employeeRecordIds: readonly string[],
) {
  // An employee sits in one batch, so the newest assignment still comes first.
  return readInBatches(employeeRecordIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_account_policy_assignments')
          .select('employee_record_id, policy_id, valid_from, valid_until')
          .eq('organization_id', organizationId)
          .in('employee_record_id', [...batch])
          .lte('valid_from', period.end)
          .or(`valid_until.is.null,valid_until.gte.${period.start}`)
          .order('valid_from', { ascending: false })
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ),
  ).then(requirePeriodRows);
}

function readPolicies(admin: AdminClient, organizationId: string) {
  return readCompleteRows(
    (from, to) =>
      admin
        .from('time_account_policies')
        .select('id, is_default, retired_at')
        .eq('organization_id', organizationId)
        .order('id')
        .range(from, to),
    PERIOD_SOURCE_ROW_CAP,
  ).then(requirePeriodRows);
}

function readPolicyVersions(
  admin: AdminClient,
  organizationId: string,
  periodEnd: string,
  policyIds: readonly string[],
) {
  return readInBatches(policyIds, (batch) =>
    admin
      .from('time_account_policy_versions')
      .select('*')
      .eq('organization_id', organizationId)
      .in('policy_id', [...batch])
      .lte('effective_from', periodEnd)
      .order('effective_from', { ascending: false })
      .order('version', { ascending: false }),
  ).then(requirePeriodRows);
}

async function readPolicyVersionRules(
  admin: AdminClient,
  organizationId: string,
  versionIds: readonly string[],
): Promise<PolicyVersionRules> {
  const [{ data: credits }, { data: supplements }, { data: warnings }] = await Promise.all([
    readInBatches(versionIds, (batch) =>
      admin
        .from('time_account_policy_credit_rules')
        .select('*')
        .eq('organization_id', organizationId)
        .in('policy_version_id', [...batch]),
    ).then(requirePeriodRows),
    readInBatches(versionIds, (batch) =>
      admin
        .from('time_account_policy_supplement_rules')
        .select('*')
        .eq('organization_id', organizationId)
        .in('policy_version_id', [...batch]),
    ).then(requirePeriodRows),
    readInBatches(versionIds, (batch) =>
      admin
        .from('time_account_policy_warning_rules')
        .select('*')
        .eq('organization_id', organizationId)
        .in('policy_version_id', [...batch]),
    ).then(requirePeriodRows),
  ]);
  return { credits, supplements, warnings };
}

// The time_account_policy_credit_rules check constraint allows 0, 50 and 100.
function toCreditPercentage(value: number): TimeCreditPercentage {
  if (value === 0 || value === 50 || value === 100) return value;
  throw new Error(`Unexpected time_account_policy_credit_rules.credit_percentage: ${value}`);
}

function toCreditRule(rule: PolicyVersionRules['credits'][number]): TimeCreditRule {
  const { activity_kind: activityKind } = rule;
  if (activityKind === 'travel')
    return {
      activityKind: 'travel',
      travelRoute: requirePresent(rule.travel_route, 'policy_credit_rule_incomplete'),
      travelRole: requirePresent(rule.travel_role, 'policy_credit_rule_incomplete'),
      percentage: toCreditPercentage(rule.credit_percentage),
    };
  if (activityKind === 'standby')
    return {
      activityKind: 'standby',
      standbyContext: requirePresent(rule.standby_context, 'policy_credit_rule_incomplete'),
      percentage: toCreditPercentage(rule.credit_percentage),
    };
  return {
    activityKind,
    percentage: toCreditPercentage(rule.credit_percentage),
  };
}

function toTimeAccountPolicy(version: PolicyVersionRow, rules: PolicyVersionRules): TimeAccountPolicy {
  const versionCredits = rules.credits.filter((rule) => rule.policy_version_id === version.id);
  const versionSupplements = rules.supplements.filter((rule) => rule.policy_version_id === version.id);
  const versionWarnings = rules.warnings.filter((warning) => warning.policy_version_id === version.id);
  const creditRules: TimeCreditRule[] = versionCredits.map(toCreditRule);
  return {
    id: version.id,
    version: version.version,
    effectiveFrom: version.effective_from,
    creditRules,
    supplementRules: (['night', 'sunday', 'public_holiday'] as const).map((kind) => ({
      supplementKind: kind,
      enabled: versionSupplements.some((rule) => rule.supplement_kind === kind && rule.enabled),
      eligibleActivityKinds: versionSupplements
        .filter((rule) => rule.supplement_kind === kind && rule.enabled)
        .map((rule) => rule.activity_kind),
    })),
    nightWindow:
      version.night_window_start && version.night_window_end
        ? {
            start: version.night_window_start.slice(0, 5),
            end: version.night_window_end.slice(0, 5),
          }
        : null,
    vacationTreatment: version.vacation_treatment,
    sicknessTreatment: version.sickness_treatment,
    warningRules: versionWarnings.map((warning) => ({
      warningKind: warning.warning_kind,
      enabled: warning.enabled,
      severity: warning.severity,
      thresholdMinutes: warning.threshold_minutes,
    })),
  };
}

function assignPoliciesByDate(input: {
  employeeRecordIds: readonly string[];
  dates: readonly string[];
  assignments: readonly PolicyAssignmentRow[];
  defaultPolicyId: string | undefined;
  versions: readonly PolicyVersionRow[];
  policyByVersionId: ReadonlyMap<string, TimeAccountPolicy>;
}): Map<string, PeriodPolicies> {
  const { employeeRecordIds, dates, assignments, defaultPolicyId, versions, policyByVersionId } = input;
  const result = new Map<string, PeriodPolicies>();
  for (const employeeRecordId of employeeRecordIds) {
    const employeeAssignments = assignments.filter(
      (assignment) => assignment.employee_record_id === employeeRecordId,
    );
    const byDate: PeriodPolicies = new Map();
    for (const date of dates) {
      const assignment = employeeAssignments.find(
        (candidate) =>
          candidate.valid_from <= date && (candidate.valid_until === null || candidate.valid_until >= date),
      );
      const policyId = assignment?.policy_id ?? defaultPolicyId;
      const version = versions.find(
        (candidate) => candidate.policy_id === policyId && candidate.effective_from <= date,
      );
      byDate.set(date, version ? (policyByVersionId.get(version.id) ?? null) : null);
    }
    result.set(employeeRecordId, byDate);
  }
  return result;
}

/** The policy in force per employee and date of the period; `null` on a day without one. */
export async function resolvePoliciesForPeriod(
  organizationId: string,
  periodStart: string,
  periodEnd: string,
  employeeRecordIds: readonly string[],
): Promise<Map<string, Map<string, TimeAccountPolicy | null>>> {
  const admin = createSupabaseAdminClient();
  const [{ data: assignments }, { data: policies }] = await Promise.all([
    readPolicyAssignments(admin, organizationId, { start: periodStart, end: periodEnd }, employeeRecordIds),
    readPolicies(admin, organizationId),
  ]);
  const defaultPolicyId = (policies ?? []).find((policy) => policy.is_default && !policy.retired_at)?.id;
  const policyIds = [
    ...new Set([
      ...(assignments ?? []).map((assignment) => assignment.policy_id),
      ...(defaultPolicyId ? [defaultPolicyId] : []),
    ]),
  ];
  if (policyIds.length === 0) return emptyPolicyCalendar(employeeRecordIds, periodStart, periodEnd);
  const { data: versions } = await readPolicyVersions(admin, organizationId, periodEnd, policyIds);
  const versionIds = (versions ?? []).map((version) => version.id);
  if (versionIds.length === 0) return emptyPolicyCalendar(employeeRecordIds, periodStart, periodEnd);
  const rules = await readPolicyVersionRules(admin, organizationId, versionIds);
  const policyByVersionId = new Map<string, TimeAccountPolicy>();
  for (const version of versions ?? [])
    policyByVersionId.set(version.id, toTimeAccountPolicy(version, rules));
  return assignPoliciesByDate({
    employeeRecordIds,
    dates: getDateRange(periodStart, periodEnd),
    assignments: assignments ?? [],
    defaultPolicyId,
    versions: versions ?? [],
    policyByVersionId,
  });
}
