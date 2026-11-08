import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { buildDocumentStoragePath, buildDocumentVersionStoragePath } from '../../documents/storage-path';
import { isUuid } from '../../validation/uuid';

export type RecoveryTarget = Readonly<{
  runId: string;
  sourceDatabase: string;
  restoredDatabase: string;
  sourceBucket: string;
  backupBucket: string;
  restoredBucket: string;
}>;

export function createRecoveryTarget(runId = randomUUID().replaceAll('-', '')): RecoveryTarget {
  if (!/^[a-f0-9]{32}$/.test(runId)) throw new Error('Invalid recovery run identity.');
  return {
    runId,
    sourceDatabase: `wf_recovery_${runId}_source`,
    restoredDatabase: `wf_recovery_${runId}_restore`,
    sourceBucket: `wf-recovery-${runId}-source`,
    backupBucket: `wf-recovery-${runId}-backup`,
    restoredBucket: `wf-recovery-${runId}-restore`,
  };
}

export function assertRecoveryResource(target: RecoveryTarget, name: string): void {
  const expected = createRecoveryTarget(target.runId);
  if (
    ![
      expected.sourceDatabase,
      expected.restoredDatabase,
      expected.sourceBucket,
      expected.backupBucket,
      expected.restoredBucket,
    ].includes(name)
  ) {
    throw new Error('Resource is outside this recovery run.');
  }
}

export function assertLocalRecoveryEndpoint(endpoint: string, localHost: string): void {
  const parsed = new URL(endpoint);
  const isPrivateHost =
    isIP(localHost) === 4 &&
    (localHost === '127.0.0.1' ||
      localHost.startsWith('10.') ||
      localHost.startsWith('192.168.') ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(localHost));
  if (
    !isPrivateHost ||
    parsed.protocol !== 'http:' ||
    parsed.hostname !== localHost ||
    parsed.port !== '54321' ||
    parsed.pathname !== '/storage/v1/s3' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Recovery requires the inspected local Storage endpoint.');
  }
}

/**
 * Docker must answer on this machine's own socket: the Linux daemon's, or the
 * default Colima VM's on a Mac. A TCP, SSH or any other socket could reach a
 * remote daemon, so the rehearsal refuses it.
 */
export function assertLocalDockerEndpoint(endpoint: string, home: string): void {
  if (
    !home.startsWith('/') ||
    home.includes('..') ||
    ![`unix:///var/run/docker.sock`, `unix://${home}/.colima/default/docker.sock`].includes(endpoint)
  ) {
    throw new Error('Recovery requires local Docker.');
  }
}

export type RecoveryStage = 'seed' | 'backup' | 'remove-source' | 'restore' | 'verify';
export type RecoveryOperations = Record<RecoveryStage, () => Promise<void>> & {
  cleanup: () => Promise<void>;
};

/**
 * Cleanup runs after every failure; success requires cleanup, too. Only fixed
 * stage names escape. Each finished stage reports its duration in whole milliseconds.
 */
export async function runRecoveryStages(
  operations: RecoveryOperations,
  record: (
    stage: RecoveryStage | 'cleanup',
    status: 'started' | 'passed' | 'failed',
    durationMs?: number,
  ) => void,
  now: () => number = performance.now.bind(performance),
): Promise<void> {
  let failure: string | undefined;
  try {
    for (const stage of ['seed', 'backup', 'remove-source', 'restore', 'verify'] as const) {
      record(stage, 'started');
      const began = now();
      try {
        await operations[stage]();
      } catch {
        record(stage, 'failed', Math.round(now() - began));
        throw new Error(stage);
      }
      record(stage, 'passed', Math.round(now() - began));
    }
  } catch (error) {
    failure =
      error instanceof Error &&
      ['seed', 'backup', 'remove-source', 'restore', 'verify'].includes(error.message)
        ? error.message
        : 'journal';
  }
  const cleanupBegan = now();
  try {
    record('cleanup', 'started');
  } catch {
    failure ??= 'journal';
  }
  try {
    await operations.cleanup();
  } catch {
    failure = failure ? `${failure}; cleanup` : 'cleanup';
  }
  try {
    record('cleanup', failure?.includes('cleanup') ? 'failed' : 'passed', Math.round(now() - cleanupBegan));
  } catch {
    failure ??= 'journal';
  }
  if (failure)
    throw new Error(
      `Recovery rehearsal failed at ${failure}. Inspect the redacted journal; no acceptance recorded.`,
    );
}

export type RecoveryResource = {
  kind: 'database' | 'bucket';
  name: string;
  state: 'planned' | 'created' | 'cleaned';
};

/** A timed-out create may have committed. Reconcile every reserved owned resource. */
export async function cleanupRecoveryResources(
  target: RecoveryTarget,
  resources: RecoveryResource[],
  removeIfPresent: (resource: RecoveryResource) => Promise<void>,
  journal: () => void,
): Promise<void> {
  let failed = false;
  for (const resource of [...resources].reverse()) {
    if (resource.state === 'cleaned') continue;
    try {
      assertRecoveryResource(target, resource.name);
      await removeIfPresent(resource);
      resource.state = 'cleaned';
      journal();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Owned cleanup incomplete.');
}

// ---------------------------------------------------------------------------
// The representative organization
// ---------------------------------------------------------------------------

export type RehearsalObject = Readonly<{ documentId: string; path: string; content: string }>;

export type RepresentativeOrganization = Readonly<{
  organizationId: string;
  foreignOrganizationId: string;
  /** Users whose reads the restored database must keep exactly. */
  readers: Readonly<{
    admin: string;
    assignedEmployee: string;
    unassignedEmployee: string;
    outsider: string;
  }>;
  /** Documents linked to a job, which only its assignees and the office read. */
  jobDocumentIds: readonly string[];
  /** Personnel documents of the admin-only and health classes. */
  protectedDocumentIds: readonly string[];
  /** Every object a current or historical document path names, in seed order. */
  objects: readonly RehearsalObject[];
  seedSql: string;
}>;

type Category = 'contract' | 'invoice' | 'offer' | 'other' | 'photo' | 'report';
type Person = Readonly<{ id: string; first: string; last: string; email: string }>;
type Job = Readonly<{ id: string; title: string; number: string; assignees: readonly Person[] }>;
type Company = Readonly<{
  organizationId: string;
  foreignOrganizationId: string;
  admin: Person;
  office: readonly Person[];
  field: readonly Person[];
  outsider: Person;
  jobs: readonly Job[];
}>;
/** The statements and objects of one seed, written in order. */
type SeedLog = { newId: () => string; statements: string[]; objects: RehearsalObject[] };

const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg' };
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const FIELD_NAMES = ['Dario', 'Elif', 'Frank', 'Greta', 'Hakan', 'Ines', 'Jannik', 'Kira'];
const JOB_TITLES = ['Heizungstausch Gasbrennwert', 'Badsanierung', 'Wartung Wärmepumpe', 'Rohrbruch Keller'];

function planCompany(newId: () => string): Company {
  const field = FIELD_NAMES.map((first, index) => ({
    id: newId(),
    first,
    last: 'Rohrbach',
    email: `monteur-${index + 1}`,
  }));
  return {
    organizationId: newId(),
    foreignOrganizationId: newId(),
    admin: { id: newId(), first: 'Anja', last: 'Brenner', email: 'inhaberin' },
    office: [
      { id: newId(), first: 'Bernd', last: 'Ostrowski', email: 'buero-1' },
      { id: newId(), first: 'Carla', last: 'Ilgner', email: 'buero-2' },
    ],
    field,
    outsider: { id: newId(), first: 'Olaf', last: 'Fremd', email: 'fremd' },
    // Two field workers per job, one on the last; the last field worker has no assignment.
    jobs: JOB_TITLES.map((title, index) => ({
      id: newId(),
      title,
      number: `RH-${index + 1}`,
      assignees: field.slice(index * 2, index * 2 + (index === JOB_TITLES.length - 1 ? 1 : 2)),
    })),
  };
}

function addObject(log: SeedLog, documentId: string, path: string): number {
  const content = `WerkFlow recovery rehearsal object ${log.objects.length + 1} for document ${documentId}.\n`;
  log.objects.push({ documentId, path, content });
  return Buffer.byteLength(content);
}

function addUpload(
  log: SeedLog,
  input: Readonly<{
    organizationId: string;
    uploader: string;
    fileName: string;
    category: Category;
    jobId?: string;
    versions?: number;
  }>,
): string {
  const documentId = log.newId();
  const owner = literal(input.organizationId);
  const mime = MIME[input.fileName.split('.').at(-1) ?? ''] ?? 'application/octet-stream';
  const path = buildDocumentStoragePath({
    organizationId: input.organizationId,
    documentId,
    fileName: input.fileName,
  });
  const size = addObject(log, documentId, path);
  log.statements.push(
    `select public.finalize_document_upload(${literal(input.uploader)}, ${owner}, ${literal(documentId)}, null, ${literal(path)}, ${literal(input.fileName)}, ${literal(input.fileName)}, '${input.category}', '${mime}', ${size}, ${input.jobId ? `'job', ${literal(input.jobId)}` : 'null, null'});`,
  );
  for (let version = 2; version <= (input.versions ?? 1); version += 1) {
    const versionPath = buildDocumentVersionStoragePath({
      organizationId: input.organizationId,
      documentId,
      versionNumber: version,
      fileName: input.fileName,
    });
    const versionSize = addObject(log, documentId, versionPath);
    log.statements.push(
      `select public.finalize_document_version_upload(${literal(input.uploader)}, ${owner}, ${literal(documentId)}, ${version - 1}, ${literal(versionPath)}, ${literal(input.fileName)}, '${mime}', ${versionSize});`,
    );
  }
  return documentId;
}

/** Each field worker's contract; the first one's payslip is admin-only, the second one's sick note health evidence. */
function addPersonnelFiles(log: SeedLog, company: Company): string[] {
  const protectedDocumentIds: string[] = [];
  for (const [index, person] of company.field.entries()) {
    // The record a membership creates for its user; without one the function refuses the file.
    const employeeRecord = `(select record.id from public.employee_records record where record.organization_id = ${literal(company.organizationId)} and record.user_id = ${literal(person.id)})`;
    const files = [
      { type: 'Arbeitsvertrag', access: 'personnel_standard' },
      ...(index === 0 ? [{ type: 'Lohnabrechnung', access: 'admin_restricted' }] : []),
      ...(index === 1 ? [{ type: 'Arbeitsunfähigkeitsbescheinigung', access: 'health_evidence' }] : []),
    ];
    for (const file of files) {
      const documentId = log.newId();
      const fileName = `personal-${index + 1}-${file.access}.pdf`;
      const path = buildDocumentStoragePath({ organizationId: company.organizationId, documentId, fileName });
      const size = addObject(log, documentId, path);
      if (file.access !== 'personnel_standard') protectedDocumentIds.push(documentId);
      const operation = log.newId();
      log.statements.push(
        `select public.finalize_personnel_document_metadata(${literal(company.admin.id)}, ${literal(company.organizationId)}, ${employeeRecord}, ${literal(documentId)}, 'organization-documents', ${literal(path)}, ${literal(fileName)}, ${literal(fileName)}, 'other', 'application/pdf', ${size}, ${literal(file.type)}, '${file.access}', 'valid', null, ${literal(operation)}, '${createHash('sha256').update(operation).digest('hex')}');`,
      );
    }
  }
  return protectedDocumentIds;
}

/** Per job a site photo, a report with an earlier version and a filed invoice. */
function addJobDocuments(log: SeedLog, company: Company): string[] {
  const own = { organizationId: company.organizationId, uploader: company.admin.id };
  return company.jobs.flatMap((job) => {
    // Display names are unique per folder, as the upload dialog keeps them.
    const invoice = addUpload(log, {
      ...own,
      fileName: `${job.number}-rechnung.pdf`,
      category: 'invoice',
      jobId: job.id,
    });
    log.statements.push(fileStatement(company, invoice));
    return [
      addUpload(log, { ...own, fileName: `${job.number}-baustelle.jpg`, category: 'photo', jobId: job.id }),
      addUpload(log, {
        ...own,
        fileName: `${job.number}-pruefbericht.pdf`,
        category: 'report',
        jobId: job.id,
        versions: 2,
      }),
      invoice,
    ];
  });
}

const fileStatement = (company: Company, documentId: string): string =>
  `select public.file_document(${literal(company.admin.id)}, ${literal(company.organizationId)}, ${literal(documentId)});`;

/** Office documents: a filed contract in three versions, an offer and its copy, a price list and a trashed photo. */
function addOfficeDocuments(log: SeedLog, company: Company): void {
  const own = { organizationId: company.organizationId, uploader: company.admin.id };
  const actor = literal(company.admin.id);
  const organization = literal(company.organizationId);
  log.statements.push(
    fileStatement(
      company,
      addUpload(log, { ...own, fileName: 'wartungsvertrag.pdf', category: 'contract', versions: 3 }),
    ),
  );
  const offer = addUpload(log, { ...own, fileName: 'angebot.pdf', category: 'offer', versions: 2 });
  addUpload(log, { ...own, fileName: 'preisliste.pdf', category: 'other' });
  const copyId = log.newId();
  const copyPath = buildDocumentStoragePath({
    organizationId: company.organizationId,
    documentId: copyId,
    fileName: 'angebot-kopie.pdf',
  });
  addObject(log, copyId, copyPath);
  log.statements.push(
    `select public.copy_document(${actor}, ${organization}, ${literal(offer)}, ${literal(copyId)}, null, ${literal(copyPath)}, 'angebot (Kopie).pdf');`,
  );
  // A trashed document keeps its bytes until permanent deletion.
  const trashed = addUpload(log, { ...own, fileName: 'altes-foto.jpg', category: 'photo' });
  log.statements.push(`select public.trash_document(${actor}, ${organization}, ${literal(trashed)});`);
}

/** People, memberships and jobs, written directly as the SQL tests do; there is no API in front of the database. */
function companySql(company: Company): string[] {
  const organization = literal(company.organizationId);
  const everyone = [company.admin, ...company.office, ...company.field, company.outsider];
  const rows = (values: string[]): string => values.join(',\n');
  return [
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values\n${rows(
      everyone.map(
        (person) =>
          `(${literal(person.id)}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${person.email}@rehearsal.example.test', '', now(), '{}', ${literal(JSON.stringify({ first_name: person.first, last_name: person.last }))}, now(), now())`,
      ),
    )};`,
    `insert into public.organizations (id, name, admin_id, unique_code) values
(${organization}, 'Brenner Haustechnik GmbH', ${literal(company.admin.id)}, 'RHBRENNR'),
(${literal(company.foreignOrganizationId)}, 'Fremd Sanitär GmbH', ${literal(company.outsider.id)}, 'RHFREMDS');`,
    `insert into public.organization_members (organization_id, user_id, role) values\n${rows([
      ...company.office.map((person) => `(${organization}, ${literal(person.id)}, 'buero')`),
      ...company.field.map((person) => `(${organization}, ${literal(person.id)}, 'employee')`),
    ])};`,
    `insert into public.jobs (id, organization_id, title, job_number, created_by) values\n${rows(
      company.jobs.map(
        (job) =>
          `(${literal(job.id)}, ${organization}, ${literal(job.title)}, '${job.number}', ${literal(company.admin.id)})`,
      ),
    )};`,
    `insert into public.job_assignments (job_id, user_id, assigned_by) values\n${rows(
      company.jobs.flatMap((job) =>
        job.assignees.map(
          (person) => `(${literal(job.id)}, ${literal(person.id)}, ${literal(company.admin.id)})`,
        ),
      ),
    )};`,
  ];
}

/**
 * A made-up SHK company shaped like the demo seeder's: admin, office and field
 * staff, jobs with assignees, and every kind of file the archive holds. Its
 * documents are written through the database functions the app's Server
 * Actions call, so every trigger, retention rule and audit event of the
 * migrated schema runs.
 */
export function planRepresentativeOrganization(newId: () => string = randomUUID): RepresentativeOrganization {
  const company = planCompany(newId);
  const [assignedEmployee] = company.field;
  const unassignedEmployee = company.field.at(-1);
  if (!assignedEmployee || !unassignedEmployee) throw new Error('The field team is incomplete.');
  const log: SeedLog = { newId, statements: [], objects: [] };
  const jobDocumentIds = addJobDocuments(log, company);
  addOfficeDocuments(log, company);
  const protectedDocumentIds = addPersonnelFiles(log, company);
  addUpload(log, {
    organizationId: company.foreignOrganizationId,
    uploader: company.outsider.id,
    fileName: 'fremdes-angebot.pdf',
    category: 'offer',
  });
  return {
    organizationId: company.organizationId,
    foreignOrganizationId: company.foreignOrganizationId,
    readers: {
      admin: company.admin.id,
      assignedEmployee: assignedEmployee.id,
      unassignedEmployee: unassignedEmployee.id,
      outsider: company.outsider.id,
    },
    jobDocumentIds,
    protectedDocumentIds,
    objects: log.objects,
    seedSql: [
      'begin;',
      ...companySql(company),
      'set local role service_role;',
      ...log.statements,
      'reset role;',
      'commit;',
    ].join('\n'),
  };
}

/**
 * Copies every object the backup still holds into the restored bucket. An
 * object the backup lacks is skipped, so reconciliation names its document
 * instead of the copy failing without one.
 */
export async function restoreObjects(
  objects: readonly RehearsalObject[],
  readBackup: (path: string) => Promise<string | undefined>,
  writeRestored: (path: string, content: string) => Promise<void>,
): Promise<void> {
  for (const object of objects) {
    const content = await readBackup(object.path);
    if (content !== undefined) await writeRestored(object.path, content);
  }
}

// ---------------------------------------------------------------------------
// Reconciling file links against the restored bucket
// ---------------------------------------------------------------------------

/** A path a restored row names: a document's current file, a historical version or a copied reference. */
export type DocumentPath = Readonly<{ documentId: string; path: string; sizeBytes: number | null }>;
export type StoredObject = Readonly<{ key: string; sizeBytes: number }>;
export type FileReconciliation = Readonly<{
  /** Documents with a path whose object is absent or has another size. */
  missingDocumentIds: readonly string[];
  /** Objects no restored row names, by the identifiers in their key. */
  orphanObjectIds: readonly string[];
}>;

/**
 * Every path a restored row names: each document's current file, trashed ones
 * included, each historical version, and each copied reference in equipment
 * history and Übergaben. One JSON array, so no path is split on a separator.
 */
export const DOCUMENT_PATHS_SQL = `select coalesce(json_agg(path order by path->>'path'), '[]') from (
  select json_build_object('documentId', id, 'path', storage_path, 'sizeBytes', size_bytes) as path from public.documents
  union all select json_build_object('documentId', document_id, 'path', storage_path, 'sizeBytes', size_bytes) from public.document_versions
  union all select json_build_object('documentId', coalesce(document_id, id), 'path', document_storage_path, 'sizeBytes', null)
    from public.installed_equipment_event_links where document_storage_path is not null
  union all select json_build_object('documentId', coalesce(document_id, id), 'path', document_storage_path, 'sizeBytes', null)
    from public.work_handover_draft_items where document_storage_path is not null
  union all select json_build_object('documentId', coalesce(document_id, id), 'path', document_storage_path, 'sizeBytes', null)
    from public.work_handover_release_items where document_storage_path is not null
) paths;`;

const documentPathRows = z.array(
  z.object({ documentId: z.string(), path: z.string(), sizeBytes: z.number().int().nullable() }),
);

export function parseDocumentPaths(output: string): DocumentPath[] {
  return documentPathRows.parse(JSON.parse(output));
}

/**
 * An object key ends in the uploaded file name, which can name a person. An
 * orphan is reported by its key's id segments only, or by a hash of the key.
 */
export function objectIdentity(key: string): string {
  const ids = key.split('/').filter((segment) => isUuid(segment));
  return ids.length > 0
    ? ids.join('/')
    : `key-sha256-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

export function reconcileDocumentPaths(
  paths: readonly DocumentPath[],
  objects: readonly StoredObject[],
): FileReconciliation {
  const stored = new Map(objects.map((object) => [object.key, object.sizeBytes]));
  const named = new Set(paths.map((path) => path.path));
  const missing = new Set<string>();
  for (const path of paths) {
    const size = stored.get(path.path);
    if (size === undefined || (path.sizeBytes !== null && size !== path.sizeBytes))
      missing.add(path.documentId);
  }
  return {
    missingDocumentIds: [...missing].sort(),
    orphanObjectIds: objects
      .filter((object) => !named.has(object.key))
      .map((object) => objectIdentity(object.key))
      .sort(),
  };
}

/**
 * Acceptance needs every named object and exactly the orphans the run expects
 * (an upload after the backup). The error names ids only, never a path or bytes.
 */
export function assertFilesReconciled(
  reconciliation: FileReconciliation,
  expectedOrphanIds: readonly string[],
): void {
  const problems: string[] = [];
  if (reconciliation.missingDocumentIds.length > 0)
    problems.push(`missing bytes for documents ${reconciliation.missingDocumentIds.join(', ')}`);
  const expected = [...expectedOrphanIds].sort();
  if (reconciliation.orphanObjectIds.join(',') !== expected.join(','))
    problems.push(
      `orphan objects ${reconciliation.orphanObjectIds.join(', ') || 'none'} instead of ${expected.join(', ') || 'none'}`,
    );
  if (problems.length > 0) throw new Error(`Restored files do not reconcile: ${problems.join('; ')}.`);
}

/**
 * The digest of a pg_dump text. pg_dump writes a fresh random `\restrict` key
 * into every dump, so two dumps of one schema differ only in those lines.
 */
export function dumpDigest(dump: string): string {
  return createHash('sha256')
    .update(
      dump
        .split('\n')
        .filter((line) => !/^\\(?:un)?restrict /.test(line))
        .join('\n'),
    )
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Comparing what each reader sees before and after the restore
// ---------------------------------------------------------------------------

/** Per table: the count and a digest of the row ids one reader sees. */
export type AccessSnapshot = Readonly<Record<string, string>>;

export function parseAccessSnapshot(output: string): AccessSnapshot {
  const snapshot: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (line === '') continue;
    const [table, visible] = line.split('|');
    if (!table || visible === undefined || table in snapshot) throw new Error('Malformed access snapshot.');
    snapshot[table] = visible;
  }
  return snapshot;
}

/** Tables whose visible rows changed for one reader; a table present on one side only counts as changed. */
export function changedAccess(before: AccessSnapshot, after: AccessSnapshot): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((table) => before[table] !== after[table])
    .sort();
}
