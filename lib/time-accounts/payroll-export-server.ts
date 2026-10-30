import 'server-only';

import { randomUUID } from 'node:crypto';

import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { buildPayrollExportPackage } from './export';
import { buildPayrollExportRows, type PayrollExportRows } from './payroll-export-rows';
import { loadPayrollExportSources, type PayrollExportSources } from './payroll-export-sources';
import { hashPayload } from './period-preparation';

// The steps of generatePayrollExport before and around the stored file. The
// action authorizes the caller and passes the admin client and its trusted
// organization and user in. Every step throws a stable code (or a provider
// error) on a refusal; the action maps it.

type PayrollExportContext = { orgId: string; userId: string };

/** A reserved export with everything its package needs. */
export type PayrollExportReservation = PayrollExportRows & {
  exportId: string;
  supersedesExportId: string | null;
  period: Tables<'time_periods'>;
  closeVersion: PayrollExportSources['closeVersion'];
  mappingVersion: PayrollExportSources['mappingVersion'];
};

const GENERATOR_VERSION = 'p1-23-v1';

// The closed period and the organization's current mapping version.
async function readPayrollExportPeriod(
  admin: AdminClient,
  context: PayrollExportContext,
  periodId: string,
): Promise<{
  period: Tables<'time_periods'>;
  calculationId: string;
  closeVersionId: string;
  mappingVersionId: string;
}> {
  const { data: period, error: periodError } = await loggedRead(
    'generatePayrollExport: time_periods read failed',
    admin
      .from('time_periods')
      .select('*')
      .eq('id', periodId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (periodError) throw new Error('load_failed');
  if (!period?.current_calculation_id || !period.current_close_version_id)
    throw new Error('period_not_closed');
  const { data: profile, error: profileError } = await loggedRead(
    'generatePayrollExport: payroll_mapping_profiles read failed',
    admin
      .from('payroll_mapping_profiles')
      .select('current_version_id')
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (profileError) throw new Error('load_failed');
  if (!profile?.current_version_id) throw new Error('mapping_not_configured');
  return {
    period,
    calculationId: period.current_calculation_id,
    closeVersionId: period.current_close_version_id,
    mappingVersionId: profile.current_version_id,
  };
}

/**
 * Builds the export rows of a closed period and reserves the export. Null
 * when the latest ready export already carries the same close version and
 * content: then nothing is generated.
 */
export async function reservePayrollExport(
  admin: AdminClient,
  context: PayrollExportContext,
  periodId: string,
): Promise<PayrollExportReservation | null> {
  const { period, calculationId, closeVersionId, mappingVersionId } = await readPayrollExportPeriod(
    admin,
    context,
    periodId,
  );
  const sources = await loadPayrollExportSources({
    admin,
    context,
    calculationId,
    closeVersionId,
    mappingVersionId,
    periodStartDate: period.period_start_date,
    periodEndDate: period.period_end_date,
  });
  const { closeVersion, mappingVersion } = sources;
  const rows = buildPayrollExportRows(sources, period);
  const contentFingerprint = hashPayload({
    periodId,
    closeVersion: closeVersion.id,
    mappingVersion: mappingVersion.id,
    valueRows: rows.valueRows,
    allocationRows: rows.allocationRows,
    correctionRows: rows.correctionRows,
  });
  const { data: latestReadyExport, error: latestReadyError } = await loggedRead(
    'generatePayrollExport: payroll_exports read failed',
    admin
      .from('payroll_exports')
      .select('id, close_version_id, content_fingerprint')
      .eq('organization_id', context.orgId)
      .eq('period_id', periodId)
      .eq('state', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  // Without the current ready export, the new one would not supersede it.
  if (latestReadyError) throw new Error('export_failed');
  if (
    latestReadyExport?.close_version_id === closeVersion.id &&
    latestReadyExport?.content_fingerprint === contentFingerprint
  )
    return null;
  const supersedesExportId = latestReadyExport?.id ?? null;
  const operationId = randomUUID();
  const { data: exportId, error: reserveError } = await admin.rpc(
    'reserve_payroll_export',
    rpcArgs('reserve_payroll_export', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_period_id: periodId,
      p_mapping_version_id: mappingVersion.id,
      p_generator_version: GENERATOR_VERSION,
      p_content_fingerprint: contentFingerprint,
      p_supersedes_export_id: supersedesExportId,
      p_operation_id: operationId,
      p_request_hash: hashPayload({ periodId, contentFingerprint }),
    }),
  );
  if (reserveError || !exportId) throw new Error(reserveError?.message ?? 'export_reservation_failed');
  return { ...rows, exportId, supersedesExportId, period, closeVersion, mappingVersion };
}

/** The ZIP package of a reserved export, with the version the reservation gave it. */
export async function buildReservedPayrollExportPackage(
  admin: AdminClient,
  context: PayrollExportContext,
  reservation: PayrollExportReservation,
): Promise<ReturnType<typeof buildPayrollExportPackage>> {
  const { exportId, supersedesExportId, period, closeVersion, mappingVersion } = reservation;
  const { data: exportRow, error: exportRowError } = await admin
    .from('payroll_exports')
    .select('version')
    .eq('organization_id', context.orgId)
    .eq('id', exportId)
    .single();
  if (exportRowError || !exportRow) throw new Error(exportRowError?.message ?? 'export_reservation_missing');
  const generatedAt = closeVersion.closed_at;
  return buildPayrollExportPackage({
    manifest: {
      schemaVersion: 1,
      exportId,
      exportVersion: exportRow.version,
      supersedesExportId,
      organizationId: context.orgId,
      periodStart: period.period_start_date,
      periodEnd: period.period_end_date,
      closeVersion: closeVersion.version,
      mappingVersion: mappingVersion.version,
      generatorVersion: GENERATOR_VERSION,
      generatedAt,
      scope: 'organization_period',
    },
    valueRows: reservation.valueRows,
    allocationRows: reservation.allocationRows,
    correctionRows: reservation.correctionRows,
  });
}

// A safe reason for the failed export row: a thrown code, or the provider's
// error code. A message that is not a code (a database or storage message can
// carry row values or keys) becomes generation_failed.
function exportFailureReason(error: unknown): string {
  if (error instanceof Error && /^[a-z][a-z0-9_]*$/.test(error.message)) return error.message;
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string')
    return `provider_error:${error.code}`;
  return 'generation_failed';
}

// Runs the generation of a reserved export. Any failure marks the export
// failed and rethrows, so no export stays generating; one whose process
// stopped altogether fails at the next reservation of its period
// (reserve_payroll_export).
export async function failReservedExportOnError(
  admin: AdminClient,
  context: PayrollExportContext,
  exportId: string,
  generate: () => Promise<void>,
): Promise<void> {
  try {
    await generate();
  } catch (error) {
    const { error: failError } = await admin.rpc('fail_payroll_export', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_export_id: exportId,
      p_failure_reason: exportFailureReason(error),
      p_operation_id: randomUUID(),
    });
    if (failError) logError('generatePayrollExport: fail_payroll_export failed', failError);
    throw error;
  }
}
