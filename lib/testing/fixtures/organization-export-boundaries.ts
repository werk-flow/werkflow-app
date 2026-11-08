// The real organization export actions over the in-memory database
// (werk-flow/werkflow-planning#287). Only an Admin starts, builds and
// downloads: a signed-out caller, Büro and an employee are refused before any
// read, and a part of another organization answers like an unknown one. The
// start plans every original of the organization once, current files and
// earlier versions, and never a foreign one. The data part lists each
// document once in its manifest, never a foreign one, and writes no join or
// invite code. A part whose file is missing fails alone: the other parts
// build, and the failed one builds again by itself. Every build claims its
// part before it stores anything; the claim queues the archive for the purge,
// so an archive whose completion answer is lost is deleted too.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';
import { assertRefused } from './operations-boundary-refusals';

const id = (suffix: string) => `87000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const folderId = id('f1');
const [currentDoc, trashedDoc, personnelDoc, foreignDoc] = [id('d1'), id('d2'), id('d3'), id('d4')];
const [dataPart, firstFilePart, secondFilePart, foreignPart] = [id('c1'), id('c2'), id('c3'), id('c4')];
const exportId = id('e1');
const path = (organizationId: string, name: string) => `${organizationId}/${name}`;
const missingPath = path(ORGANIZATION_A, 'd2/angebot.pdf');

function document(
  documentId: string,
  organizationId: string,
  name: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: documentId,
    organization_id: organizationId,
    folder_id: null,
    storage_bucket: 'organization-documents',
    storage_path: path(organizationId, `${documentId.slice(-2)}/${name}`),
    original_file_name: name,
    display_name: name,
    mime_type: 'application/pdf',
    size_bytes: 10,
    category: 'offer',
    current_version_number: 1,
    uploaded_by: CALLER_ID,
    copied_from_document_id: null,
    metadata: {},
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    deleted_at: null,
    deleted_by: null,
    delete_reason: null,
    document_date: '2026-10-01',
    retention_class: null,
    retention_ends_on: null,
    filed_at: null,
    filed_by: null,
    source_system: 'Sykasoft',
    source_reference: 'R-77',
    ...extra,
  };
}

const exportPart = (partId: string, partNumber: number, kind: string) => ({
  id: partId,
  organization_id: ORGANIZATION_A,
  export_id: exportId,
  part_number: partNumber,
  kind,
  state: 'pending',
  archive_path: `${ORGANIZATION_A}/datenexporte/${exportId}/teil-${partNumber}.zip`,
});

const exportFile = (partId: string, documentId: string, sourcePath: string, archiveName: string) => ({
  id: `${partId}-${archiveName}`,
  organization_id: ORGANIZATION_A,
  export_id: exportId,
  part_id: partId,
  document_id: documentId,
  version_number: null,
  source_path: sourcePath,
  archive_name: archiveName,
  file_bytes: 10,
});

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, name: 'Muster Haustechnik', admin_id: CALLER_ID, unique_code: 'JOIN-SECRET-A' },
    { id: ORGANIZATION_B, name: 'Fremd GmbH', admin_id: id('b1'), unique_code: 'JOIN-SECRET-B' },
  ],
  organization_members: [
    { id: id('a1'), organization_id: ORGANIZATION_A, user_id: CALLER_ID, role: 'admin' },
  ],
  organization_invites: [{ id: id('a2'), organization_id: ORGANIZATION_A, invite_code: 'INVITE-SECRET' }],
  profiles: [{ id: CALLER_ID, first_name: 'Kim', last_name: 'Berger', email: 'caller@example.test' }],
  document_folders: [
    {
      id: folderId,
      organization_id: ORGANIZATION_A,
      parent_folder_id: null,
      name: 'Kunden',
      created_by: CALLER_ID,
      created_at: '2026-10-01T08:00:00Z',
      updated_at: '2026-10-01T08:00:00Z',
      deleted_at: null,
    },
  ],
  documents: [
    document(currentDoc, ORGANIZATION_A, 'vertrag.pdf', { folder_id: folderId, current_version_number: 2 }),
    document(trashedDoc, ORGANIZATION_A, 'angebot.pdf', { deleted_at: '2026-10-05T08:00:00Z' }),
    document(personnelDoc, ORGANIZATION_A, 'arbeitsvertrag.pdf'),
    document(foreignDoc, ORGANIZATION_B, 'fremd.pdf'),
  ],
  document_versions: [
    {
      id: id('b2'),
      organization_id: ORGANIZATION_A,
      document_id: currentDoc,
      version_number: 1,
      storage_path: path(ORGANIZATION_A, 'd1/versions/1-vertrag.pdf'),
      original_file_name: 'vertrag-alt.pdf',
      size_bytes: 8,
    },
    {
      id: id('b3'),
      organization_id: ORGANIZATION_B,
      document_id: foreignDoc,
      version_number: 1,
      storage_path: path(ORGANIZATION_B, 'd4/versions/1-fremd.pdf'),
      original_file_name: 'fremd-alt.pdf',
      size_bytes: 8,
    },
  ],
  document_links: [],
  personnel_documents: [
    {
      id: id('a3'),
      organization_id: ORGANIZATION_A,
      document_id: personnelDoc,
      access_class: 'admin_restricted',
    },
  ],
  organization_exports: [
    { id: exportId, organization_id: ORGANIZATION_A, requested_at: new Date().toISOString(), part_count: 3 },
  ],
  organization_export_parts: [
    exportPart(dataPart, 1, 'data'),
    exportPart(firstFilePart, 2, 'files'),
    exportPart(secondFilePart, 3, 'files'),
    { ...exportPart(foreignPart, 2, 'files'), organization_id: ORGANIZATION_B },
  ],
  organization_export_files: [
    exportFile(
      firstFilePart,
      currentDoc,
      path(ORGANIZATION_A, 'd1/vertrag.pdf'),
      'Dateien/Kunden/vertrag.pdf',
    ),
    exportFile(firstFilePart, trashedDoc, missingPath, 'Dateien/Papierkorb/Ohne Ordner/angebot.pdf'),
    exportFile(
      secondFilePart,
      personnelDoc,
      path(ORGANIZATION_A, 'd3/arbeitsvertrag.pdf'),
      'Dateien/Personalakten/arbeitsvertrag.pdf',
    ),
  ],
});

// The stored files: one original is missing until the retry.
let missingFileArrived = false;
// The part whose completion answer the next build loses.
let losesCompletion: string | null = null;
const storedArchives: { path: string; body: Uint8Array }[] = [];
// Claims, results and stores in the order a build made them, by part file name.
const steps: string[] = [];
const partFile = (partId: string) =>
  tableRows(world, 'organization_export_parts')
    .find((part) => part.id === partId)
    ?.archive_path?.toString()
    .split('/')
    .at(-1);
mock.module('@/lib/storage/r2', () => ({
  readStorageObject: async ({ path: key }: { organizationId: string; path: string }) => {
    if (key === missingPath && !missingFileArrived) throw new Error('storage_object_missing');
    return new TextEncoder().encode(`bytes of ${key}`);
  },
  // A key once written keeps its object, as the conditional write in R2 does.
  putStorageObject: async ({
    path: key,
    body,
    ifAbsent,
  }: {
    path: string;
    body: Uint8Array;
    ifAbsent?: boolean;
  }) => {
    steps.push(`store ${key.split('/').at(-1) ?? ''}`);
    const stored = storedArchives.find((archive) => archive.path === key);
    if (ifAbsent && stored) return { created: false, sizeBytes: stored.body.length };
    storedArchives.push({ path: key, body });
    return { created: true };
  },
  createSignedDownloadUrl: async ({ path: key }: { path: string }) => `https://storage.example.test/${key}`,
}));

// The database functions as the SQL proves them (supabase/tests/organization_export.sql):
// a part outside the caller's organization is unknown; every call names the caller;
// the claim refuses a ready part and an export past its seven days.
const ownParts = new Set([dataPart, firstFilePart, secondFilePart]);
const columns: Record<string, string[]> = {
  organizations: ['id', 'name', 'admin_id', 'unique_code'],
  organization_invites: ['id', 'organization_id', 'invite_code'],
  documents: ['id', 'organization_id', 'display_name', 'source_reference'],
};
world.rpc = ({ name, args }) => {
  assert.equal(args.p_actor_id ?? CALLER_ID, CALLER_ID, `${name} named another actor`);
  if (name === 'read_organization_export_page')
    return {
      data: {
        columns: columns[String(args.p_table)] ?? ['id', 'organization_id'],
        rows: tableRows(world, String(args.p_table)).filter(
          (row) => row.organization_id === args.p_organization_id,
        ),
      },
      error: null,
    };
  if (name === 'start_organization_export') return { data: exportId, error: null };
  if (
    args.p_organization_id !== ORGANIZATION_A ||
    typeof args.p_part_id !== 'string' ||
    !ownParts.has(args.p_part_id)
  )
    return { data: null, error: { code: 'P0001', message: 'export_part_not_found' } };
  const part = tableRows(world, 'organization_export_parts').find((row) => row.id === args.p_part_id);
  steps.push(`${name.split('_')[0] ?? name} ${partFile(args.p_part_id) ?? ''}`);
  if (name === 'complete_organization_export_part' && losesCompletion === args.p_part_id) {
    losesCompletion = null;
    return { data: null, error: { code: '08006', message: 'connection lost' } };
  }
  if (name !== 'claim_organization_export_part_build') return { data: null, error: null };
  const startedExport = tableRows(world, 'organization_exports').find((row) => row.id === part?.export_id);
  if (part?.state === 'ready') return { data: null, error: { code: 'P0001', message: 'export_part_ready' } };
  if (Date.parse(String(startedExport?.requested_at)) <= Date.now() - 7 * 24 * 60 * 60 * 1000)
    return { data: null, error: { code: 'P0001', message: 'export_part_expired' } };
  return {
    data: {
      exportId: part?.export_id,
      kind: part?.kind,
      archivePath: part?.archive_path,
      partCount: startedExport?.part_count,
    },
    error: null,
  };
};

const { buildOrganizationExportPart, downloadOrganizationExportPart, startOrganizationExport } = await import(
  '@/lib/org-export/actions'
);

// A signed-out caller, Büro and an employee are refused before any read.
signInAs(world, null);
await assertRefused(
  world,
  [['signed out start', () => startOrganizationExport()]],
  { success: false, error: 'no_active_org' },
  'none',
);
for (const role of ['buero', 'employee'] as const) {
  signInAs(world, role);
  await assertRefused(
    world,
    [
      [`${role} start`, () => startOrganizationExport()],
      [`${role} build`, () => buildOrganizationExportPart(firstFilePart)],
      [`${role} download`, () => downloadOrganizationExportPart(firstFilePart)],
    ],
    { success: false, error: 'not_authorized' },
    'none',
  );
}

// The Admin of another organization reaches no part of this one: it is unknown.
signInAs(world, 'admin', ORGANIZATION_B);
await assertRefused(
  world,
  [['foreign admin build', () => buildOrganizationExportPart(firstFilePart)]],
  { success: false, error: 'export_part_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['foreign admin download', () => downloadOrganizationExportPart(firstFilePart)]],
  { success: false, error: 'export_part_not_found' },
  'one-call',
);
signInAs(world, 'admin');
await assertRefused(
  world,
  [['foreign part build', () => buildOrganizationExportPart(foreignPart)]],
  { success: false, error: 'export_part_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['foreign part download', () => downloadOrganizationExportPart(foreignPart)]],
  { success: false, error: 'export_part_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['malformed part id', () => buildOrganizationExportPart('../teil')]],
  { success: false, error: 'invalid_input' },
  'none',
);

// The start plans every original of the organization once and no foreign one.
world.rpcCalls.length = 0;
const started = await startOrganizationExport();
assert.deepEqual(started, { success: true, exportId, partIds: [dataPart, firstFilePart, secondFilePart] });
const plan = world.rpcCalls.find((call) => call.name === 'start_organization_export')?.args.p_file_parts;
assert.ok(Array.isArray(plan), 'the start sent no plan');
const planned = plan.flat();
assert.deepEqual(
  planned.map((file) =>
    typeof file === 'object' && file !== null && 'archiveName' in file ? file.archiveName : null,
  ),
  [
    'Dateien/Kunden/vertrag (Version 1).pdf',
    'Dateien/Kunden/vertrag.pdf',
    'Dateien/Papierkorb/Ohne Ordner/angebot.pdf',
    'Dateien/Personalakten/arbeitsvertrag.pdf',
  ],
  'the plan is not every original of the organization exactly once',
);
assert.ok(!JSON.stringify(plan).includes(ORGANIZATION_B), 'the plan names a foreign file');

// A missing original fails its part alone, and the action answers the stored
// reason; the next part builds. Each build claims its part, which queues the
// archive for the purge, before it stores.
steps.length = 0;
assert.deepEqual(await buildOrganizationExportPart(firstFilePart), {
  success: false,
  error: 'storage_object_missing',
});
assert.equal(
  world.rpcCalls.find((call) => call.name === 'fail_organization_export_part')?.args.p_failure_reason,
  'storage_object_missing',
);
assert.equal(storedArchives.length, 0, 'a failed part stored an archive');
assert.deepEqual(await buildOrganizationExportPart(secondFilePart), { success: true });
assert.deepEqual(
  steps,
  ['claim teil-2.zip', 'fail teil-2.zip', 'claim teil-3.zip', 'store teil-3.zip', 'complete teil-3.zip'],
  'a build stored its archive before its claim queued the archive for the purge',
);

// The failed part builds again by itself, at its own path. Its completion
// answer is lost: the archive is stored after the claim queued it, so the
// purge deletes it although no completion is recorded.
missingFileArrived = true;
losesCompletion = firstFilePart;
steps.length = 0;
assert.deepEqual(await buildOrganizationExportPart(firstFilePart), {
  success: false,
  error: 'export_part_failed',
});
assert.deepEqual(
  steps,
  ['claim teil-2.zip', 'store teil-2.zip', 'complete teil-2.zip'],
  'an archive whose completion is lost was stored before its claim queued it for the purge',
);
assert.deepEqual(
  storedArchives.map((archive) => archive.path.split('/').at(-1)),
  ['teil-3.zip', 'teil-2.zip'],
);

// The stored-ZIP entries of an archive, by name.
function zipEntries(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, string>();
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  for (let offset = 0; view.getUint32(offset, true) === 0x04034b50; ) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const start = offset + 30 + nameLength + view.getUint16(offset + 28, true);
    entries.set(
      decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength)),
      decoder.decode(bytes.slice(start, start + size)),
    );
    offset = start + size;
  }
  return entries;
}

// The data part: every record as CSV, a manifest naming each document once, no secret.
assert.deepEqual(await buildOrganizationExportPart(dataPart), { success: true });
const dataArchive = storedArchives.at(-1);
assert.ok(dataArchive, 'the data part stored no archive');
const entries = zipEntries(dataArchive.body);
for (const name of [
  'Daten/Aufträge.csv',
  'Daten/Dokumente.csv',
  'Daten/Organisation.csv',
  'Daten/Organisation_Einladungen.csv',
  'Daten/Personen.csv',
  'Dokumentenverzeichnis.csv',
  'LIESMICH.txt',
  'Spaltenverzeichnis.csv',
])
  assert.ok(entries.has(name), `the data part lacks ${name}`);
assert.ok(![...entries.keys()].some((name) => name.includes('Anmelde') || name.includes('rate_limit')));
// The file plans and part states of exports stay out: every export would carry all earlier ones.
for (const name of ['Daten/Datenexporte_Dateien.csv', 'Daten/Datenexporte_Teile.csv'])
  assert.ok(!entries.has(name), `the data part holds ${name}`);
const readmeOf = (archive: Map<string, string>) =>
  (archive.get('LIESMICH.txt') ?? '').replaceAll('\r\n', ' ');
assert.ok(readmeOf(entries).includes('Der Export besteht aus 3 Teilen.'), 'the README miscounts the parts');
assert.ok(
  readmeOf(entries).includes('nach dem Start hochgeladen wurde, steht nur in „Daten/Dokumente.csv“'),
  'the README claims the manifest notes a document uploaded after the start',
);
const manifest = entries.get('Dokumentenverzeichnis.csv') ?? '';
for (const documentId of [currentDoc, trashedDoc, personnelDoc])
  assert.equal(manifest.split(documentId).length - 1, 1, `the manifest lists ${documentId} other than once`);
const everything = [...entries.values()].join('\n');
for (const foreign of [foreignDoc, ORGANIZATION_B, 'Fremd GmbH'])
  assert.ok(!everything.includes(foreign), `the export holds ${foreign}`);
for (const secret of ['JOIN-SECRET-A', 'INVITE-SECRET', 'unique_code', 'invite_code'])
  assert.ok(!everything.includes(secret), `the export holds ${secret}`);
assert.ok(entries.get('Daten/Dokumente.csv')?.startsWith('﻿ID;Organisation-ID;Anzeigename;Alte Nummer\r\n'));
assert.ok(manifest.includes('Personalakte, nur Admin'), 'the manifest lost the personnel class');
// The plan holds the first version's file of a document that has a second one now: the manifest says so.
assert.ok(
  manifest.includes('Nach dem Start des Exports neue Version 2, nicht im Export'),
  'the manifest hides a version uploaded after the start',
);

// A second build of a part whose archive is stored, concurrent or after a lost
// completion, keeps the stored archive and records its size.
const storedFirstPart = storedArchives.find((archive) => archive.path.endsWith('/teil-2.zip'));
assert.ok(storedFirstPart, 'the first file part stored no archive');
world.rpcCalls.length = 0;
const archiveCount = storedArchives.length;
assert.deepEqual(await buildOrganizationExportPart(firstFilePart), { success: true });
assert.equal(storedArchives.length, archiveCount, 'a second build overwrote a stored archive');
assert.deepEqual(
  world.rpcCalls.map((call) => [call.name, call.args.p_archive_bytes]),
  [
    ['claim_organization_export_part_build', undefined],
    ['complete_organization_export_part', storedFirstPart.body.length],
  ],
);

// A column the dictionary does not know fails the data part instead of leaving it out.
columns.documents = [...(columns.documents ?? []), 'brand_new_column'];
world.rpcCalls.length = 0;
assert.deepEqual(await buildOrganizationExportPart(dataPart), {
  success: false,
  error: 'export_dictionary_incomplete',
});
assert.equal(
  world.rpcCalls.find((call) => call.name === 'fail_organization_export_part')?.args.p_failure_reason,
  'export_dictionary_incomplete',
);

// An export of one part has no further parts, and its README names none.
columns.documents = columns.documents.filter((column) => column !== 'brand_new_column');
const [onePartExport] = tableRows(world, 'organization_exports');
assert.ok(onePartExport);
onePartExport.part_count = 1;
storedArchives.splice(storedArchives.indexOf(dataArchive), 1);
assert.deepEqual(await buildOrganizationExportPart(dataPart), { success: true });
const onePartReadme = readmeOf(zipEntries(storedArchives.at(-1)?.body ?? new Uint8Array()));
assert.ok(onePartReadme.includes('diesem einen Archiv mit allen Daten'), 'the README of one part miscounts');
assert.ok(!onePartReadme.includes('weiteren Teile'), 'the README of one part names further parts');
onePartExport.part_count = 3;

// A ready part refuses another build, and an export past its seven days builds no part.
const parts = tableRows(world, 'organization_export_parts');
const readyPart = parts.find((part) => part.id === secondFilePart);
assert.ok(readyPart);
readyPart.state = 'ready';
await assertRefused(
  world,
  [['ready part build', () => buildOrganizationExportPart(secondFilePart)]],
  { success: false, error: 'export_part_ready' },
  'one-call',
);
const [startedExport] = tableRows(world, 'organization_exports');
assert.ok(startedExport);
startedExport.requested_at = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
await assertRefused(
  world,
  [['expired export build', () => buildOrganizationExportPart(firstFilePart)]],
  { success: false, error: 'export_part_expired' },
  'one-call',
);

// A download names the part and goes through the recorded download.
world.rpc = ({ name, args }) =>
  name === 'record_organization_export_download' && args.p_part_id === firstFilePart
    ? {
        data: {
          archivePath: `${ORGANIZATION_A}/datenexporte/${exportId}/teil-2.zip`,
          partNumber: 2,
          partCount: 3,
          requestedAt: '2026-11-08T10:00:00Z',
        },
        error: null,
      }
    : { data: null, error: { code: 'P0001', message: 'export_part_not_found' } };
assert.deepEqual(await downloadOrganizationExportPart(firstFilePart), {
  success: true,
  url: `https://storage.example.test/${ORGANIZATION_A}/datenexporte/${exportId}/teil-2.zip`,
});

// The page reads every part of an export, past one page, and a missing part fails the read.
const { readOrganizationExports } = await import('@/lib/org-export/reads');
const manyParts = Array.from({ length: 1_001 }, (_, index) => ({
  ...exportPart(id(`f${String(index).padStart(4, '0')}`), index + 1, index === 0 ? 'data' : 'files'),
  export_id: id('e2'),
}));
world.tables.organization_exports = [
  {
    id: id('e2'),
    organization_id: ORGANIZATION_A,
    requested_at: new Date().toISOString(),
    part_count: 1_001,
  },
];
world.tables.organization_export_parts = manyParts;
const listed = await readOrganizationExports(ORGANIZATION_A);
assert.ok(listed.success, 'the export list failed');
assert.equal(listed.exports[0]?.parts.length, 1_001, 'the export list lost parts');
world.tables.organization_export_parts = manyParts.slice(1);
assert.deepEqual(await readOrganizationExports(ORGANIZATION_A), { success: false, error: 'load_failed' });
