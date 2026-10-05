import 'server-only';

// Hydration of document, folder, version, and audit rows into their view
// models. These are internal server helpers, not Server Actions: they take the
// admin client from an authorized caller in actions.ts and must never be
// exported from a 'use server' module.

import { toProfileReference, type ProfileReferenceRow } from '@/lib/profile-reference';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import {
  toDocumentFolder,
  toDocumentLink,
  toDocumentAuditEvent,
  toDocumentVersion,
  toOrganizationDocument,
  type DocumentAuditEvent,
  type DocumentAuditEventRow,
  type DocumentFolder,
  type DocumentFolderRow,
  type DocumentLink,
  type DocumentLinkRow,
  type DocumentResult,
  type DocumentRow,
  type DocumentVersion,
  type DocumentVersionRow,
  type OrganizationDocument,
} from './types';

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

function collectDocumentLinkTargetIds(linkRows: DocumentLinkRow[]): {
  jobIds: string[];
  projectIds: string[];
  clientIds: string[];
  employeeIds: string[];
  requestIds: string[];
  equipmentIds: string[];
  serviceCaseIds: string[];
  maintenanceCoverageIds: string[];
} {
  const jobIds = Array.from(
    new Set(linkRows.map((link) => link.job_id).filter((id): id is string => Boolean(id))),
  );
  const projectIds = Array.from(
    new Set(linkRows.map((link) => link.project_id).filter((id): id is string => Boolean(id))),
  );
  const clientIds = Array.from(
    new Set(linkRows.map((link) => link.client_id).filter((id): id is string => Boolean(id))),
  );
  const employeeIds = Array.from(
    new Set(linkRows.map((link) => link.employee_id).filter((id): id is string => Boolean(id))),
  );
  const requestIds = Array.from(
    new Set(linkRows.map((link) => link.request_id).filter((id): id is string => Boolean(id))),
  );
  const equipmentIds = Array.from(
    new Set(linkRows.map((link) => link.equipment_id).filter((id): id is string => Boolean(id))),
  );
  const serviceCaseIds = Array.from(
    new Set(linkRows.map((link) => link.service_case_id).filter((id): id is string => Boolean(id))),
  );
  const maintenanceCoverageIds = Array.from(
    new Set(linkRows.map((link) => link.maintenance_coverage_id).filter((id): id is string => Boolean(id))),
  );
  return {
    jobIds,
    projectIds,
    clientIds,
    employeeIds,
    requestIds,
    equipmentIds,
    serviceCaseIds,
    maintenanceCoverageIds,
  };
}

async function readDocumentLinkTargets(
  admin: SupabaseAdmin,
  organizationIds: string[],
  targetIds: ReturnType<typeof collectDocumentLinkTargetIds>,
) {
  const {
    jobIds,
    projectIds,
    clientIds,
    employeeIds,
    requestIds,
    equipmentIds,
    serviceCaseIds,
    maintenanceCoverageIds,
  } = targetIds;
  const [
    jobsResult,
    projectsResult,
    clientsResult,
    employeesResult,
    requestsResult,
    equipmentResult,
    serviceCasesResult,
    maintenanceCoveragesResult,
  ] = await Promise.all([
    jobIds.length > 0
      ? readInBatches(jobIds, (ids) =>
          admin
            .from('jobs')
            .select('id, title, job_number')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    projectIds.length > 0
      ? readInBatches(projectIds, (ids) =>
          admin
            .from('projects')
            .select('id, name, project_number')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    clientIds.length > 0
      ? readInBatches(clientIds, (ids) =>
          admin
            .from('clients')
            .select('id, name')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    employeeIds.length > 0
      ? readInBatches(employeeIds, (ids) =>
          admin
            .from('profiles')
            .select('id, first_name, last_name, email')
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    requestIds.length > 0
      ? readInBatches(requestIds, (ids) =>
          admin
            .from('client_requests')
            .select('id, request_number, summary')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    equipmentIds.length > 0
      ? readInBatches(equipmentIds, (ids) =>
          admin
            .from('installed_equipment')
            .select('id, equipment_number, name')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    serviceCaseIds.length > 0
      ? readInBatches(serviceCaseIds, (ids) =>
          admin
            .from('service_cases')
            .select('id, case_number, summary')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
    maintenanceCoverageIds.length > 0
      ? readInBatches(maintenanceCoverageIds, (ids) =>
          admin
            .from('maintenance_coverages')
            .select('id, coverage_number')
            .in('organization_id', organizationIds)
            .in('id', [...ids]),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    [
      jobsResult,
      projectsResult,
      clientsResult,
      employeesResult,
      requestsResult,
      equipmentResult,
      serviceCasesResult,
      maintenanceCoveragesResult,
    ].some((result) => result.error)
  )
    throw new Error('Dokumentverknüpfungen konnten nicht geladen werden.');
  return {
    jobsResult,
    projectsResult,
    clientsResult,
    employeesResult,
    requestsResult,
    equipmentResult,
    serviceCasesResult,
    maintenanceCoveragesResult,
  };
}

function indexDocumentLinkTargets(results: Awaited<ReturnType<typeof readDocumentLinkTargets>>) {
  const {
    jobsResult,
    projectsResult,
    clientsResult,
    employeesResult,
    requestsResult,
    equipmentResult,
    serviceCasesResult,
    maintenanceCoveragesResult,
  } = results;
  const jobsById = new Map(
    (
      (jobsResult.data ?? []) as Array<{
        id: string;
        title: string;
        job_number: string | null;
      }>
    ).map((job) => [job.id, job]),
  );
  const projectsById = new Map(
    (
      (projectsResult.data ?? []) as Array<{
        id: string;
        name: string;
        project_number: string | null;
      }>
    ).map((project) => [project.id, project]),
  );
  const clientsById = new Map(
    (
      (clientsResult.data ?? []) as Array<{
        id: string;
        name: string;
      }>
    ).map((client) => [client.id, client]),
  );
  const employeesById = new Map(
    (
      (employeesResult.data ?? []) as Array<{
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      }>
    ).map((employee) => [employee.id, employee]),
  );
  const requestsById = new Map(
    (
      (requestsResult.data ?? []) as Array<{
        id: string;
        request_number: string | null;
        summary: string;
      }>
    ).map((request) => [request.id, request]),
  );
  const equipmentById = new Map(
    (
      (equipmentResult.data ?? []) as Array<{
        id: string;
        equipment_number: string;
        name: string;
      }>
    ).map((equipment) => [equipment.id, equipment]),
  );
  const serviceCasesById = new Map(
    (
      (serviceCasesResult.data ?? []) as Array<{
        id: string;
        case_number: string;
        summary: string;
      }>
    ).map((serviceCase) => [serviceCase.id, serviceCase]),
  );
  const maintenanceCoveragesById = new Map(
    (
      (maintenanceCoveragesResult.data ?? []) as Array<{
        id: string;
        coverage_number: string;
      }>
    ).map((coverage) => [coverage.id, coverage]),
  );
  return {
    jobsById,
    projectsById,
    clientsById,
    employeesById,
    requestsById,
    equipmentById,
    serviceCasesById,
    maintenanceCoveragesById,
  };
}

function buildDocumentLinksByDocumentId(
  linkRows: DocumentLinkRow[],
  targets: ReturnType<typeof indexDocumentLinkTargets>,
): Map<string, DocumentLink[]> {
  const {
    jobsById,
    projectsById,
    clientsById,
    employeesById,
    requestsById,
    equipmentById,
    serviceCasesById,
    maintenanceCoveragesById,
  } = targets;
  const linksByDocumentId = new Map<string, DocumentLink[]>();
  for (const linkRow of linkRows) {
    const job = linkRow.job_id ? jobsById.get(linkRow.job_id) : null;
    const project = linkRow.project_id ? projectsById.get(linkRow.project_id) : null;
    const client = linkRow.client_id ? clientsById.get(linkRow.client_id) : null;
    const employee = linkRow.employee_id ? employeesById.get(linkRow.employee_id) : null;
    const request = linkRow.request_id ? requestsById.get(linkRow.request_id) : null;
    const equipment = linkRow.equipment_id ? equipmentById.get(linkRow.equipment_id) : null;
    const serviceCase = linkRow.service_case_id ? serviceCasesById.get(linkRow.service_case_id) : null;
    const maintenanceCoverage = linkRow.maintenance_coverage_id
      ? maintenanceCoveragesById.get(linkRow.maintenance_coverage_id)
      : null;
    const employeeName = employee
      ? [employee.first_name, employee.last_name].filter(Boolean).join(' ') || employee.email
      : null;
    const links = linksByDocumentId.get(linkRow.document_id) ?? [];
    links.push(
      toDocumentLink(linkRow, {
        jobTitle: job?.title ?? null,
        jobNumber: job?.job_number ?? null,
        projectName: project?.name ?? null,
        projectNumber: project?.project_number ?? null,
        clientName: client?.name ?? null,
        employeeName: employeeName ?? null,
        employeeEmail: employee?.email ?? null,
        requestNumber: request?.request_number ?? null,
        requestSummary: request?.summary ?? null,
        equipmentNumber: equipment?.equipment_number ?? null,
        equipmentName: equipment?.name ?? null,
        serviceCaseNumber: serviceCase?.case_number ?? null,
        serviceCaseSummary: serviceCase?.summary ?? null,
        maintenanceCoverageNumber: maintenanceCoverage?.coverage_number ?? null,
      }),
    );
    linksByDocumentId.set(linkRow.document_id, links);
  }
  return linksByDocumentId;
}

type OrdinaryDocumentViewRow = Database['public']['Views']['ordinary_documents']['Row'];

/**
 * Rows of the `ordinary_documents` view as `documents` rows. The view selects
 * NOT NULL table columns, but Postgres reports every view column as nullable,
 * so a row without its required columns is dropped and logged.
 */
export function documentRowsFromOrdinaryView(rows: readonly OrdinaryDocumentViewRow[]): DocumentRow[] {
  const documents = rows.flatMap((row): DocumentRow[] => {
    const {
      id,
      organization_id,
      category,
      created_at,
      current_version_number,
      display_name,
      original_file_name,
      size_bytes,
      storage_bucket,
      storage_path,
      updated_at,
      uploaded_by,
    } = row;
    if (
      id === null ||
      organization_id === null ||
      category === null ||
      created_at === null ||
      current_version_number === null ||
      display_name === null ||
      original_file_name === null ||
      size_bytes === null ||
      storage_bucket === null ||
      storage_path === null ||
      updated_at === null ||
      uploaded_by === null
    ) {
      return [];
    }
    return [
      {
        id,
        organization_id,
        category,
        created_at,
        current_version_number,
        display_name,
        original_file_name,
        size_bytes,
        storage_bucket,
        storage_path,
        updated_at,
        uploaded_by,
        copied_from_document_id: row.copied_from_document_id,
        delete_reason: row.delete_reason,
        deleted_at: row.deleted_at,
        deleted_by: row.deleted_by,
        folder_id: row.folder_id,
        metadata: row.metadata,
        mime_type: row.mime_type,
      },
    ];
  });
  if (documents.length !== rows.length) {
    logError(`Dropped ${rows.length - documents.length} ordinary_documents rows without required columns`);
  }
  return documents;
}

export async function hydrateDocuments(
  admin: SupabaseAdmin,
  rows: DocumentRow[],
): Promise<OrganizationDocument[]> {
  if (rows.length === 0) return [];

  const documentIds = rows.map((row) => row.id);
  const uploaderIds = Array.from(new Set(rows.map((row) => row.uploaded_by)));
  // Every related read stays inside the documents' organizations; the admin client bypasses RLS.
  const organizationIds = [...new Set(rows.map((row) => row.organization_id))];

  const [linksResult, profilesResult] = await Promise.all([
    readInBatches(documentIds, (ids) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('document_links')
            .select('*')
            .in('document_id', [...ids])
            .in('organization_id', organizationIds)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(uploaderIds, (ids) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', [...ids]),
    ),
  ]);

  if (linksResult.error || profilesResult.error)
    throw new Error('Dokumentverknüpfungen konnten nicht vollständig geladen werden.');
  const linkRows = (linksResult.data ?? []) as DocumentLinkRow[];
  const targetResults = await readDocumentLinkTargets(
    admin,
    organizationIds,
    collectDocumentLinkTargetIds(linkRows),
  );
  const linksByDocumentId = buildDocumentLinksByDocumentId(linkRows, indexDocumentLinkTargets(targetResults));

  const profilesById = new Map(
    ((profilesResult.data ?? []) as ProfileReferenceRow[]).map((profile) => [profile.id, profile]),
  );

  return rows.map((row) =>
    toOrganizationDocument({
      row,
      uploader: toProfileReference(profilesById.get(row.uploaded_by)),
      links: linksByDocumentId.get(row.id) ?? [],
    }),
  );
}

/**
 * hydrateDocuments for an action that reports a failed related read as a
 * result, never as a throw: `null` when hydration failed (logged).
 */
export async function hydrateDocumentsOrNull(
  admin: SupabaseAdmin,
  rows: DocumentRow[],
  failureLabel: string,
): Promise<OrganizationDocument[] | null> {
  try {
    return await hydrateDocuments(admin, rows);
  } catch (error) {
    logError(failureLabel, error);
    return null;
  }
}

/**
 * The result of a committed document write. A failed hydration returns
 * `documents_failed`, so the caller never reports the write itself as failed.
 */
export async function hydrateWrittenDocument(
  admin: SupabaseAdmin,
  row: DocumentRow,
): Promise<DocumentResult> {
  const [document] =
    (await hydrateDocumentsOrNull(admin, [row], 'Failed to hydrate a written document')) ?? [];
  if (!document) return { success: false, error: 'documents_failed' };
  return { success: true, document };
}

export async function hydrateFolders(
  admin: SupabaseAdmin,
  rows: DocumentFolderRow[],
): Promise<DocumentFolder[]> {
  if (rows.length === 0) return [];

  const creatorIds = Array.from(new Set(rows.map((row) => row.created_by)));
  const { data: profiles, error } = await readInBatches(creatorIds, (ids) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email, avatar_path')
      .in('id', [...ids]),
  );
  if (error) throw new Error('Ordnerinformationen konnten nicht vollständig geladen werden.');

  const profilesById = new Map(
    ((profiles ?? []) as ProfileReferenceRow[]).map((profile) => [profile.id, profile]),
  );

  return rows.map((row) => toDocumentFolder(row, toProfileReference(profilesById.get(row.created_by))));
}

/** Null when the uploader names could not be read (logged). */
export async function hydrateDocumentVersions(
  admin: SupabaseAdmin,
  rows: DocumentVersionRow[],
): Promise<DocumentVersion[] | null> {
  if (rows.length === 0) return [];

  const uploaderIds = Array.from(new Set(rows.map((row) => row.uploaded_by)));
  const { data: profiles, error } = await readInBatches(uploaderIds, (ids) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email, avatar_path')
      .in('id', [...ids]),
  );
  if (error) {
    logReadFailure('hydrateDocumentVersions: uploader profiles failed', error);
    return null;
  }

  const profilesById = new Map((profiles as ProfileReferenceRow[]).map((profile) => [profile.id, profile]));

  return rows.map((row) =>
    toDocumentVersion({
      row,
      uploader: toProfileReference(profilesById.get(row.uploaded_by)),
    }),
  );
}

/** Null when the actor names could not be read (logged). */
export async function hydrateDocumentAuditEvents(
  admin: SupabaseAdmin,
  rows: DocumentAuditEventRow[],
): Promise<DocumentAuditEvent[] | null> {
  if (rows.length === 0) return [];

  const actorIds = Array.from(
    new Set(rows.map((row) => row.actor_id).filter((actorId): actorId is string => Boolean(actorId))),
  );
  const { data: profiles, error } = await readInBatches(actorIds, (ids) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email, avatar_path')
      .in('id', [...ids]),
  );
  if (error) {
    logReadFailure('hydrateDocumentAuditEvents: actor profiles failed', error);
    return null;
  }

  const profilesById = new Map((profiles as ProfileReferenceRow[]).map((profile) => [profile.id, profile]));

  return rows.map((row) =>
    toDocumentAuditEvent({
      row,
      actor: row.actor_id ? toProfileReference(profilesById.get(row.actor_id)) : null,
    }),
  );
}
