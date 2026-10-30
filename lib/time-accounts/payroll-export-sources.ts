import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { PERIOD_SOURCE_ROW_CAP, requirePeriodRows } from './period-sources';
import type { PayrollValueKind } from './types';

// The closed-period rows a payroll export is built from. generatePayrollExport
// authorizes the caller and passes the admin client and its organization in.
// Every list is read completely; a failed or overflowing read stops the export.

/** Account events that the payroll export carries as value rows. */
export const PAYROLL_ACCOUNT_EVENT_KINDS = [
  'opening_balance',
  'manual_adjustment',
  'expiry',
  'payout',
] as const satisfies readonly PayrollValueKind[];

export type PayrollExportSources = {
  calculation: Tables<'time_period_calculations'>;
  closeVersion: Tables<'time_period_close_versions'>;
  mappingVersion: Tables<'payroll_mapping_versions'>;
  employeeMappings: Tables<'payroll_employee_mappings'>[];
  codeMappings: Tables<'payroll_code_mappings'>[];
  employeeResults: Tables<'time_period_employee_results'>[];
  employeeIds: string[];
  dailyResults: Tables<'time_period_daily_results'>[];
  resultSources: Tables<'time_period_result_sources'>[];
  accountEvents: Tables<'time_account_events'>[];
  correctionRequests: Pick<Tables<'time_correction_requests'>, 'id' | 'subject_employee_record_id'>[];
  correctionApplications: Pick<
    Tables<'time_correction_applications'>,
    'id' | 'request_id' | 'revision' | 'source_fingerprint' | 'applied_snapshot'
  >[];
};

type PayrollExportSourceInput = {
  admin: AdminClient;
  context: { orgId: string };
  calculationId: string;
  closeVersionId: string;
  mappingVersionId: string;
  periodStartDate: string;
  periodEndDate: string;
};

export async function loadPayrollExportSources(
  input: PayrollExportSourceInput,
): Promise<PayrollExportSources> {
  const { calculation, closeVersion, mappingVersion, employeeMappings, codeMappings, employeeResults } =
    await readPayrollCalculationSources(input);
  const employeeResultIds = (employeeResults ?? []).map((result) => result.id);
  const employeeIds = (employeeResults ?? []).map((result) => result.employee_record_id);
  const { dailyResults, resultSources, accountEvents, correctionRequests } = await readPayrollEmployeeSources(
    input,
    employeeResultIds,
    employeeIds,
  );
  const correctionRequestIds = (correctionRequests ?? []).map((request) => request.id);
  const correctionApplications = await readPayrollCorrectionApplications(input, correctionRequestIds);
  return {
    calculation,
    closeVersion,
    mappingVersion,
    employeeMappings,
    codeMappings,
    employeeResults,
    employeeIds,
    dailyResults,
    resultSources,
    accountEvents,
    correctionRequests,
    correctionApplications,
  };
}

// The calculation, close and mapping versions with their mapping and result
// rows. A missing version stops the export as export_context_missing.
async function readPayrollCalculationSources(
  input: PayrollExportSourceInput,
): Promise<
  Pick<
    PayrollExportSources,
    | 'calculation'
    | 'closeVersion'
    | 'mappingVersion'
    | 'employeeMappings'
    | 'codeMappings'
    | 'employeeResults'
  >
> {
  const { admin, context, calculationId, closeVersionId, mappingVersionId } = input;
  const [
    { data: calculation },
    { data: closeVersion },
    { data: mappingVersion },
    { data: employeeMappings },
    { data: codeMappings },
    { data: employeeResults },
  ] = await Promise.all([
    admin
      .from('time_period_calculations')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('id', calculationId)
      .single(),
    admin
      .from('time_period_close_versions')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('id', closeVersionId)
      .single(),
    admin
      .from('payroll_mapping_versions')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('id', mappingVersionId)
      .single(),
    readCompleteRows(
      (from, to) =>
        admin
          .from('payroll_employee_mappings')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('mapping_version_id', mappingVersionId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('payroll_code_mappings')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('mapping_version_id', mappingVersionId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_period_employee_results')
          .select('*')
          .eq('organization_id', context.orgId)
          .eq('calculation_id', calculationId)
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ).then(requirePeriodRows),
  ]);
  if (!calculation || !closeVersion || !mappingVersion) throw new Error('export_context_missing');
  return { calculation, closeVersion, mappingVersion, employeeMappings, codeMappings, employeeResults };
}

// The daily results, result sources, account events and correction requests
// of the period's employee results.
async function readPayrollEmployeeSources(
  input: PayrollExportSourceInput,
  employeeResultIds: readonly string[],
  employeeIds: readonly string[],
): Promise<
  Pick<PayrollExportSources, 'dailyResults' | 'resultSources' | 'accountEvents' | 'correctionRequests'>
> {
  const { admin, context, periodStartDate, periodEndDate } = input;
  const [
    { data: dailyResults },
    { data: resultSources },
    { data: accountEvents },
    { data: correctionRequests },
  ] = await Promise.all([
    readInBatches(employeeResultIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_period_daily_results')
            .select('*')
            .eq('organization_id', context.orgId)
            .in('employee_result_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(employeeResultIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_period_result_sources')
            .select('*')
            .eq('organization_id', context.orgId)
            .in('employee_result_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(employeeIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_account_events')
            .select('*')
            .eq('organization_id', context.orgId)
            .in('employee_record_id', [...batch])
            .gte('effective_date', periodStartDate)
            .lte('effective_date', periodEndDate)
            .in('event_kind', [...PAYROLL_ACCOUNT_EVENT_KINDS])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
    readInBatches(employeeIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_correction_requests')
            .select('id, subject_employee_record_id')
            .eq('organization_id', context.orgId)
            .in('subject_employee_record_id', [...batch])
            .order('id')
            .range(from, to),
        PERIOD_SOURCE_ROW_CAP,
      ),
    ).then(requirePeriodRows),
  ]);
  return { dailyResults, resultSources, accountEvents, correctionRequests };
}

async function readPayrollCorrectionApplications(
  input: PayrollExportSourceInput,
  correctionRequestIds: readonly string[],
): Promise<PayrollExportSources['correctionApplications']> {
  const { admin, context } = input;
  const { data: correctionApplications } = await readInBatches(correctionRequestIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_correction_applications')
          .select('id, request_id, revision, source_fingerprint, applied_snapshot')
          .eq('organization_id', context.orgId)
          .in('request_id', [...batch])
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ),
  ).then(requirePeriodRows);
  return correctionApplications;
}
