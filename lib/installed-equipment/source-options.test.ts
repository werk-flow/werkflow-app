import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';

// The source dialog read every job, project, revision, release and document
// of the equipment's customer at its site. The reader now reads one
// equipment's documents, or the revisions and releases of the one job or
// project the dialog chose, after proving that the equipment and the work
// belong to the caller's organization, the equipment's customer and its site.
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  installed_equipment: [
    { id: 'equipment-1', organization_id: 'org', client_id: 'client-1', site_id: 'site-1', voided_at: null },
    {
      id: 'equipment-foreign',
      organization_id: 'other',
      client_id: 'client-9',
      site_id: 'site-9',
      voided_at: null,
    },
  ],
  jobs: [
    {
      id: 'job-1',
      organization_id: 'org',
      client_id: 'client-1',
      site_id: 'site-1',
      job_number: 'AUF-1',
      title: 'Einbau',
    },
    {
      id: 'job-other-client',
      organization_id: 'org',
      client_id: 'client-2',
      site_id: 'site-1',
      job_number: 'AUF-2',
      title: 'Fremd',
    },
    {
      id: 'job-foreign',
      organization_id: 'other',
      client_id: 'client-1',
      site_id: 'site-1',
      job_number: 'AUF-3',
      title: 'Fremd',
    },
  ],
  projects: [],
  work_artifacts: [
    { id: 'artifact-1', organization_id: 'org', job_id: 'job-1', project_id: null },
    { id: 'artifact-foreign', organization_id: 'other', job_id: 'job-foreign', project_id: null },
  ],
  work_handover_packages: [{ id: 'package-1', organization_id: 'org', job_id: 'job-1', project_id: null }],
  work_artifact_revisions: [
    {
      id: 'revision-1',
      organization_id: 'org',
      artifact_id: 'artifact-1',
      revision_number: 2,
      title: 'Inbetriebnahme',
    },
  ],
  work_handover_releases: [
    { id: 'release-1', organization_id: 'org', package_id: 'package-1', release_number: 1 },
  ],
  document_links: [
    { id: 'link-1', organization_id: 'org', equipment_id: 'equipment-1', document_id: 'document-1' },
  ],
  documents: [
    {
      id: 'document-1',
      organization_id: 'org',
      display_name: 'Datenblatt',
      current_version_number: 3,
      deleted_at: null,
    },
  ],
};
let readTables: string[] = [];
let manager = true;

const admin = {
  from: (table: string) => {
    readTables.push(table);
    const filters: Array<(row: Row) => boolean> = [];
    const rows = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value);
        return builder;
      },
      in: (column: string, values: readonly unknown[]) => {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      // Only the site rule `site_id.is.null,site_id.eq.<id>` is used here.
      or: (rule: string) => {
        const site = rule.split('site_id.eq.')[1];
        filters.push((row) => row.site_id === null || row.site_id === site);
        return builder;
      },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (result: { data: Row[]; error: null }) => void) =>
        resolve({ data: rows(), error: null }),
    };
    return builder;
  },
};

mock.module('server-only', () => ({}));
mock.module('@/lib/jobs/auth', () => ({
  authenticateAndAuthorize: async () => ({
    success: true,
    context: {
      orgId: 'org',
      userId: 'user',
      role: manager ? 'buero' : 'employee',
      isManagerOrAbove: manager,
    },
  }),
}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => admin }));

const { getEquipmentSourceOptions } = await import('./source-options-server');
const loggedFailures = spyOn(console, 'error').mockImplementation(() => undefined);
afterAll(() => loggedFailures.mockRestore());

beforeEach(() => {
  readTables = [];
  manager = true;
});

test('the chosen job yields only its own revisions and releases', async () => {
  const result = await getEquipmentSourceOptions({
    equipmentId: 'equipment-1',
    work: { type: 'job', id: 'job-1' },
  });
  if (!result.success) throw new Error(result.error);
  expect(result.options.map((option) => [option.value, option.label])).toEqual([
    ['artifact_revision:revision-1', 'Inbetriebnahme, Revision 2'],
    ['handover_release:release-1', 'Auftrag AUF-1, Freigabe 1'],
  ]);
  expect(readTables).not.toContain('document_links');
});

test('without a work the equipment offers its own documents only', async () => {
  const result = await getEquipmentSourceOptions({ equipmentId: 'equipment-1', work: null });
  if (!result.success) throw new Error(result.error);
  expect(result.options.map((option) => option.value)).toEqual(['document:document-1:3']);
  expect(readTables).not.toContain('jobs');
  expect(readTables).not.toContain('work_artifacts');
});

test('a foreign equipment is not found and nothing behind it is read', async () => {
  expect(
    await getEquipmentSourceOptions({
      equipmentId: 'equipment-foreign',
      work: { type: 'job', id: 'job-foreign' },
    }),
  ).toEqual({ success: false, error: 'installed_equipment_not_found' });
  expect(readTables).toEqual(['installed_equipment']);
});

test('work of another organization or customer is refused before its sources are read', async () => {
  for (const jobId of ['job-foreign', 'job-other-client']) {
    readTables = [];
    expect(
      await getEquipmentSourceOptions({ equipmentId: 'equipment-1', work: { type: 'job', id: jobId } }),
    ).toEqual({ success: false, error: 'installed_equipment_source_target_invalid' });
    expect(readTables).toEqual(['installed_equipment', 'jobs']);
  }
});

test('a field worker is refused before any read', async () => {
  manager = false;
  expect(await getEquipmentSourceOptions({ equipmentId: 'equipment-1', work: null })).toEqual({
    success: false,
    error: 'not_authorized',
  });
  expect(readTables).toEqual([]);
});
