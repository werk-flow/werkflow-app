import { createAdminClient, persisted, type Persisted } from './shared';

// Problem reports read back for the report journey (docs/features/problem-reports.md).

export type PersistedProblemReport = Persisted<{
  number: number;
  reporterId: string;
  status: string;
  description: string | null;
  scrubState: string;
  fileKinds: string[];
}>;

/** The report a person just sent, by its organization and number, with the kinds of its files. */
export async function getProblemReportByNumber(
  orgId: string,
  number: number,
): Promise<PersistedProblemReport> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('problem_reports')
    .select('id, number, reporter_id, status, description, scrub_state')
    .eq('organization_id', orgId)
    .eq('number', number)
    .single();
  if (error) throw new Error(`Problem report ${number} lookup failed: ${error.message}`);
  const files = await admin
    .from('problem_report_files')
    .select('kind')
    .eq('organization_id', orgId)
    .eq('report_id', data.id);
  if (files.error) throw new Error(`Problem report ${number} file lookup failed: ${files.error.message}`);
  return persisted({
    number: data.number,
    reporterId: data.reporter_id,
    status: data.status,
    description: data.description,
    scrubState: data.scrub_state,
    fileKinds: files.data.map((file) => file.kind).sort(),
  });
}
