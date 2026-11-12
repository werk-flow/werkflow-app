import 'server-only';

import { randomUUID } from 'node:crypto';

import type { AdminClient } from '@/lib/supabase/admin';
import { readCompleteRows } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { PayrollCodeMapping } from './payroll-mapping';
import { hashPayload, PERIOD_SOURCE_ROW_CAP, requirePeriodRows } from './period-sources';
import { requireRead } from './read-support';

/**
 * Saves a new mapping version: the Admin's codes, and every person's current
 * Personalnummer. `basedOnVersion` is the version the Admin's table showed
 * (null before the first one); the database refuses the save with
 * `stale_version` when another version is current by now. Throws a stable
 * code (or a provider error) on every refusal; the action maps it.
 */
export async function savePayrollMappingVersion(
  admin: AdminClient,
  context: { orgId: string; userId: string },
  codeMappings: PayrollCodeMapping[],
  basedOnVersion: number | null,
): Promise<void> {
  const { data: employees } = await readCompleteRows(
    (from, to) =>
      admin
        .from('employee_records')
        .select('id, employee_number')
        .eq('organization_id', context.orgId)
        .order('created_at')
        .order('id')
        .range(from, to),
    PERIOD_SOURCE_ROW_CAP,
  ).then(requirePeriodRows);
  const employeeMappings = employees.map((employee) => {
    if (!employee.employee_number) throw new Error('employee_number_required');
    return { employee_record_id: employee.id, external_employee_reference: employee.employee_number };
  });
  const payload = { employeeMappings, codeMappings, basedOnVersion };
  const { error } = await admin.rpc(
    'confirm_payroll_mapping_version',
    rpcArgs('confirm_payroll_mapping_version', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_expected_version: basedOnVersion,
      p_employee_mappings: employeeMappings,
      p_code_mappings: codeMappings,
      p_operation_id: randomUUID(),
      p_request_hash: hashPayload(payload),
    }),
  );
  if (error) throw error;
}

/** The current mapping version with its codes, or null before the first confirmation. A failed read throws. */
export async function readCurrentPayrollMapping(
  admin: AdminClient,
  organizationId: string,
  currentVersionId: string | null,
): Promise<{ version: number; confirmedAt: string; codes: PayrollCodeMapping[] } | null> {
  if (!currentVersionId) return null;
  const [version, codes] = await Promise.all([
    admin
      .from('payroll_mapping_versions')
      .select('version, confirmed_at')
      .eq('organization_id', organizationId)
      .eq('id', currentVersionId)
      .single()
      .then(requireRead),
    // One row per PAYROLL_CODE_ROWS entry: a version holds about twenty codes.
    admin
      .from('payroll_code_mappings')
      .select('value_kind, activity_kind, output_code')
      .eq('organization_id', organizationId)
      .eq('mapping_version_id', currentVersionId)
      .then(requireRead),
  ]);
  return { version: version.version, confirmedAt: version.confirmed_at, codes };
}
