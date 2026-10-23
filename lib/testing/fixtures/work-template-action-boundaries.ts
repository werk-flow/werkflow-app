// Actual Arbeitsvorlagen actions over the in-memory database: an employee
// reads, writes and applies no template and is refused before the database,
// a manager of organization A reads no template or published version of
// organization B, and each write names the caller's organization, so the
// function's org-scoped lookup refuses a foreign template, version or target.
import assert from 'node:assert/strict';
import { ORGANIZATION_B, installActionWorld, signInAs, tableRows } from './action-boundary-world';
import { assertCallerScopedCalls, databaseSnapshot } from './workforce-boundary-support';

const foreignTemplateId = '87000000-0000-4000-8000-000000000001';
const foreignVersionId = '87000000-0000-4000-8000-000000000002';
const foreignProjectId = '87000000-0000-4000-8000-000000000003';
const itemId = '87000000-0000-4000-8000-000000000004';

const world = installActionWorld({
  work_templates: [
    {
      id: foreignTemplateId,
      organization_id: ORGANIZATION_B,
      target_type: 'project',
      name: 'Badsanierung',
      description: null,
      archived_at: null,
      draft_version_id: null,
      current_published_version_id: foreignVersionId,
      updated_at: '2026-10-01T08:00:00.000Z',
    },
  ],
  work_template_versions: [
    {
      id: foreignVersionId,
      organization_id: ORGANIZATION_B,
      template_id: foreignTemplateId,
      version_number: 1,
    },
  ],
  projects: [{ id: foreignProjectId, organization_id: ORGANIZATION_B }],
});
// The template functions load their template, version and target inside the
// organization they are given (supabase/tests/p1_13_*.sql); here only that lookup.
const refusals: Readonly<Record<string, readonly [string, string, string]>> = {
  save_work_template_draft: ['work_templates', 'p_template_id', 'work_template_draft_not_found'],
  publish_work_template: ['work_templates', 'p_template_id', 'work_template_draft_not_found'],
  create_work_template_draft: [
    'work_templates',
    'p_template_id',
    'work_template_published_version_not_found',
  ],
  set_work_template_archived: ['work_templates', 'p_template_id', 'work_template_not_found'],
  apply_work_template: ['projects', 'p_project_id', 'work_template_application_target_invalid'],
};
world.rpc = ({ name, args }) => {
  const refusal = refusals[name];
  if (!refusal) return { data: null, error: { code: 'P0001', message: `unexpected_function_${name}` } };
  const [table, idArgument, message] = refusal;
  const found = tableRows(world, table).some(
    (row) => row.id === args[idArgument] && row.organization_id === args.p_organization_id,
  );
  return found ? { data: itemId, error: null } : { data: null, error: { code: 'P0001', message } };
};
const {
  applyWorkTemplate,
  createNextWorkTemplateDraft,
  createWorkTemplate,
  getPublishedWorkTemplates,
  getWorkTemplate,
  getWorkTemplatePreview,
  getWorkTemplates,
  publishWorkTemplate,
  saveWorkTemplateDraft,
  setWorkTemplateArchived,
} = await import('@/lib/work-templates/actions');

const initialDatabase = databaseSnapshot(world);
const notAuthorized = { success: false, error: 'not_authorized' };
const draft = {
  name: 'Badsanierung',
  description: null,
  items: [
    {
      id: itemId,
      itemKind: 'task' as const,
      content: 'Altes Bad zurückbauen',
      requirementState: 'required' as const,
      groupLabel: null,
      notes: null,
      sortOrder: 0,
    },
  ],
  evidence: [],
  dependencies: [],
  materials: [],
  capabilities: [],
};
const apply = () =>
  applyWorkTemplate({
    templateVersionId: foreignVersionId,
    projectId: foreignProjectId,
    idempotencyKey: 'apply-1',
  });
const writes = [
  () => saveWorkTemplateDraft({ templateId: foreignTemplateId, draft }),
  () => publishWorkTemplate(foreignTemplateId),
  () => createNextWorkTemplateDraft(foreignTemplateId),
  () => setWorkTemplateArchived(foreignTemplateId, true),
  apply,
];

// An employee reads, creates, changes and applies no template, before any database access.
signInAs(world, 'employee');
assert.deepEqual(await getWorkTemplates(), notAuthorized);
assert.deepEqual(await getWorkTemplate(foreignTemplateId), notAuthorized);
assert.deepEqual(await getPublishedWorkTemplates('project'), notAuthorized);
assert.deepEqual(
  await getWorkTemplatePreview({
    versionId: foreignVersionId,
    targetType: 'project',
    projectId: foreignProjectId,
  }),
  notAuthorized,
);
assert.deepEqual(
  await createWorkTemplate({ targetType: 'job', name: 'Wartung', description: null }),
  notAuthorized,
);
for (const write of writes) {
  assert.deepEqual(await write(), notAuthorized);
}
assert.equal(world.adminClientRequests, 0);

// A Büro manager of organization A reads no template or published version of organization B.
signInAs(world, 'buero');
assert.deepEqual(await getWorkTemplate(foreignTemplateId), { success: false, error: 'not_found' });
assert.deepEqual(
  await getWorkTemplatePreview({
    versionId: foreignVersionId,
    targetType: 'project',
    projectId: foreignProjectId,
  }),
  { success: false, error: 'not_found' },
);
const published = await getPublishedWorkTemplates('project');
assert.ok(published.success);
assert.deepEqual(published.data, []);
const summaries = await getWorkTemplates();
assert.ok(summaries.success);
assert.deepEqual(summaries.data, []);

// Each write names the caller's organization and is refused by its one call; nothing changes.
for (const write of writes) {
  world.rpcCalls.length = 0;
  assert.deepEqual(await write(), { success: false, error: 'operation_failed' });
  assert.equal(world.rpcCalls.length, 1, 'a refused write made a second call');
  assertCallerScopedCalls(world);
}
assert.equal(databaseSnapshot(world), initialDatabase, 'no refused call may write');
