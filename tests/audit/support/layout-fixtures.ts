import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../lib/supabase/database.types';
import type { CheckpointValues } from '../../../lib/testing/spec-support/checkpoints';
import { equipmentCreateSchema } from '../../../lib/installed-equipment/validation';
import { serviceCaseCreateSchema } from '../../../lib/service-cases/validation';
import type { Locator, Page } from '@playwright/test';
import { requireEnv } from '../../golden/support/env';
import { testSupabaseClientOptions } from '../../golden/support/client-options';
import { SERVICE_AREA_HEADER } from '../../golden/support/steps/service';
import { TIME_AREA_HEADER } from '../../golden/support/steps/time-tracking';
import type { TestWorld } from '../../golden/support/world';
import { auditCheckpoint, saveAuditCheckpoint } from './checkpoints';

type LayoutDetails = NonNullable<CheckpointValues['layout.details']>;

/** The area layouts with a shared header: title, subpage navigation and the subpage the audit visits. */
const AREA_HEADERS = {
  time: TIME_AREA_HEADER,
  service: SERVICE_AREA_HEADER,
} as const;
type AreaWithHeader = keyof typeof AREA_HEADERS;

export function areaHeaderTitle(header: Locator, area: AreaWithHeader): Locator {
  return header.getByRole('heading', { level: 1, name: AREA_HEADERS[area].title, exact: true });
}

export function areaNavigation(header: Locator, area: AreaWithHeader): Locator {
  return header.getByRole('navigation', { name: AREA_HEADERS[area].navigation, exact: true });
}

export function areaSubpageHeading(page: Page, area: AreaWithHeader): Locator {
  return page.getByRole('heading', { level: 2, name: AREA_HEADERS[area].subpageHeading, exact: true });
}

/**
 * The date and time pair of a DateTimeField, found from its date picker's id.
 * A `has` locator is queried inside each match, so it starts at the page.
 */
export function dateTimeFieldGrid(scope: Locator, datePickerId: string): Locator {
  return scope.getByTestId('date-time-field-grid').filter({ has: scope.page().locator(`#${datePickerId}`) });
}

export function layoutNames(
  world: TestWorld,
): Record<'client' | 'project' | 'job' | 'nestedJob' | 'request' | 'equipment' | 'serviceCase', string> {
  return {
    client: `Layout Heizungsbau Kunde ${world.runId}`,
    project: `Layout Modernisierung Heizungsanlage ${world.runId}`,
    job: `Layout Wartung und Sicherheitsprüfung ${world.runId}`,
    nestedJob: `Layout Montage und Inbetriebnahme ${world.runId}`,
    request: `Layout Anfrage zur Heizungsmodernisierung ${world.runId}`,
    equipment: `Layout Wärmeerzeuger im Technikraum ${world.runId}`,
    serviceCase: `Layout Heizungsstörung mit Kundenrückfrage ${world.runId}`,
  };
}

/** Creates page inputs only. These cases prove rendered layout, not creation workflows. */
export async function prepareLayoutDetails(world: TestWorld): Promise<LayoutDetails> {
  if (world.auditGroup !== 'layout/mobile-viewport.spec.ts')
    throw new Error('Layout fixtures require their owning audit world.');
  const server = createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SECRET_KEY'),
    testSupabaseClientOptions,
  );
  const existing = auditCheckpoint('layout.details');
  if (existing) {
    const { data, error } = await server
      .from('clients')
      .select('id')
      .eq('id', existing.clientId)
      .eq('organization_id', world.orgId)
      .single();
    if (error || !data) throw new Error('Retained layout fixtures no longer belong to this world.');
    return existing;
  }
  const names = layoutNames(world);
  const clientId = randomUUID();
  const siteId = randomUUID();
  const projectId = randomUUID();
  const jobId = randomUUID();
  const nestedJobId = randomUUID();
  const requestId = randomUUID();
  const projectNumber = `PRJ-${world.runId}-LAYOUT`;
  const jobNumber = `AUF-${world.runId}-LAYOUT`;
  const nestedJobNumber = `AUF-${world.runId}-LAYOUT-P`;
  // All rows cascade from the already archived disposable organization. No
  // Auth users, storage objects or resources outside that ownership are created.
  await server
    .from('clients')
    .insert({ id: clientId, organization_id: world.orgId, name: names.client })
    .throwOnError();
  await server
    .from('client_sites')
    .insert({
      id: siteId,
      organization_id: world.orgId,
      client_id: clientId,
      name: 'Technikraum im Verwaltungsgebäude',
      street: 'Heizungsbauerstraße 125',
      postal_code: '10115',
      city: 'Berlin',
      created_by: world.users.admin.id,
      is_primary: true,
    })
    .throwOnError();
  await server
    .from('projects')
    .insert({
      id: projectId,
      organization_id: world.orgId,
      created_by: world.users.admin.id,
      client_id: clientId,
      site_id: siteId,
      name: names.project,
      project_number: projectNumber,
    })
    .throwOnError();
  await server
    .from('jobs')
    .insert([
      {
        id: jobId,
        organization_id: world.orgId,
        created_by: world.users.admin.id,
        client_id: clientId,
        site_id: siteId,
        title: names.job,
        job_number: jobNumber,
      },
      {
        id: nestedJobId,
        organization_id: world.orgId,
        created_by: world.users.admin.id,
        client_id: clientId,
        site_id: siteId,
        project_id: projectId,
        title: names.nestedJob,
        job_number: nestedJobNumber,
      },
    ])
    .throwOnError();
  await server
    .from('job_assignments')
    .insert(
      [jobId, nestedJobId].map((id) => ({
        job_id: id,
        organization_id: world.orgId,
        assigned_by: world.users.admin.id,
        user_id: world.users.employee.id,
      })),
    )
    .throwOnError();
  await server
    .from('client_requests')
    .insert({
      id: requestId,
      organization_id: world.orgId,
      client_id: clientId,
      site_id: siteId,
      created_by: world.users.admin.id,
      summary: names.request,
      details: 'Die bestehende Anlage soll geprüft und anschließend modernisiert werden.',
    })
    .throwOnError();
  const equipment = equipmentCreateSchema.parse({
    equipmentId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientId,
    siteId,
    name: names.equipment,
    category: 'heat_generation',
    state: 'active',
    identifiers: [],
  });
  const { data: equipmentRow } = await server
    .rpc('create_installed_equipment', {
      p_actor_id: world.users.admin.id,
      p_equipment_id: equipment.equipmentId,
      p_idempotency_key: equipment.idempotencyKey,
      p_organization_id: world.orgId,
      p_payload: equipment,
    })
    .throwOnError();
  if (!equipmentRow) throw new Error('Layout equipment fixture returned no saved record.');
  const serviceCase = serviceCaseCreateSchema.parse({
    serviceCaseId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientId,
    siteId,
    summary: names.serviceCase,
    originalStatement: 'Die Heizung bleibt kalt. Bitte einen Wartungstermin abstimmen.',
    chargeContext: 'unknown',
    equipmentIds: [equipment.equipmentId],
  });
  const { data: serviceRow } = await server
    .rpc('create_service_case', {
      p_actor_id: world.users.admin.id,
      p_service_case_id: serviceCase.serviceCaseId,
      p_idempotency_key: serviceCase.idempotencyKey,
      p_organization_id: world.orgId,
      p_payload: serviceCase,
    })
    .throwOnError();
  if (!serviceRow) throw new Error('Layout service fixture returned no saved record.');
  const result = {
    clientId,
    requestId,
    projectId,
    projectNumber,
    jobId,
    jobNumber,
    nestedJobNumber,
    equipmentNumber: equipmentRow.equipment_number,
    caseNumber: serviceRow.case_number,
  };
  saveAuditCheckpoint('layout.details', result);
  return result;
}
