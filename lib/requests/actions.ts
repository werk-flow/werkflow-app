'use server';

import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import { validateSiteAndContactForClient } from '@/lib/clients/site-contact-validation';
import { createJob, type CreateJobInput } from '@/lib/jobs/actions';
import { createProject, type CreateProjectInput } from '@/lib/projects/actions';
import type { ClientType } from '@/lib/jobs/types';
import {
  type ClientRequest,
  type ClientRequestResult,
  type ConvertRequestResult,
  type RequestCategory,
  type RequestCloseReason,
  type RequestSource,
  type RequestUrgency,
  toClientRequest,
} from '@/lib/requests/types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

// ============================================
// Input Types
// ============================================

export type CreateClientRequestInput = {
  summary: string;
  details?: string;
  requestNumber?: string;
  clientId?: string;
  contactId?: string;
  siteId?: string;
  callerName?: string;
  callerPhone?: string;
  callerEmail?: string;
  callerAddress?: string;
  category?: RequestCategory;
  urgency?: RequestUrgency;
  source?: RequestSource;
  assignedTo?: string;
  receivedAt?: string;
};

export type UpdateClientRequestInput = Partial<
  Omit<CreateClientRequestInput, 'clientId' | 'contactId' | 'siteId'>
> & {
  // Explicit null clears the reference (e.g. undoing a wrong customer match).
  clientId?: string | null;
  contactId?: string | null;
  siteId?: string | null;
  status?: 'offen' | 'in_klaerung';
};

// ============================================
// Helpers
// ============================================

// Content and reference edits are only allowed while the request is open;
// converted and closed requests keep their captured history read-only.
const EDITABLE_STATUSES = ['offen', 'in_klaerung'] as const;

async function recordRequestEvent(
  admin: AdminClient,
  input: {
    orgId: string;
    requestId: string;
    eventType: string;
    eventPayload?: Record<string, unknown>;
    actorId: string;
  }
): Promise<void> {
  const { error } = await admin.from('client_request_events').insert({
    organization_id: input.orgId,
    request_id: input.requestId,
    event_type: input.eventType,
    event_payload: input.eventPayload ?? {},
    created_by: input.actorId,
  });

  if (error) {
    // The audit trail must not block the business action; surface it in logs.
    console.error('Failed to record client request event:', error);
  }
}

async function requireManagerAndRequest(requestId: string): Promise<
  | {
      success: true;
      context: { orgId: string; userId: string; admin: AdminClient };
      request: ClientRequest;
    }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;

  if (!isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('client_requests')
    .select('*')
    .eq('id', requestId)
    .eq('organization_id', orgId)
    .single();

  if (error || !data) {
    return { success: false, error: 'request_not_found' };
  }

  return {
    success: true,
    context: { orgId, userId, admin },
    request: toClientRequest(data),
  };
}

function isValidTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

async function validateAssignee(
  admin: AdminClient,
  orgId: string,
  assignedTo: string
): Promise<boolean> {
  const { data } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', orgId)
    .eq('user_id', assignedTo)
    .maybeSingle();
  return Boolean(data);
}

// ============================================
// Capture And Maintain
// ============================================

export async function createClientRequest(
  input: CreateClientRequestInput
): Promise<ClientRequestResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const summary = input.summary.trim();
    if (!summary) {
      return { success: false, error: 'summary_required' };
    }

    const admin = createSupabaseAdminClient();

    const clientId = input.clientId?.trim() || null;
    if (clientId) {
      const { data: client } = await admin
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (!client) {
        return { success: false, error: 'client_not_found' };
      }
    }

    const siteId = input.siteId?.trim() || null;
    const contactId = input.contactId?.trim() || null;
    const siteContactCheck = await validateSiteAndContactForClient(
      admin,
      orgId,
      clientId,
      siteId,
      contactId
    );
    if (!siteContactCheck.success) {
      return siteContactCheck;
    }

    const assignedTo = input.assignedTo?.trim() || null;
    if (assignedTo && !(await validateAssignee(admin, orgId, assignedTo))) {
      return { success: false, error: 'assignee_not_found' };
    }

    const requestNumber = input.requestNumber?.trim() || null;
    if (requestNumber) {
      const { data: existingNumber } = await admin
        .from('client_requests')
        .select('id')
        .eq('organization_id', orgId)
        .eq('request_number', requestNumber)
        .maybeSingle();
      if (existingNumber) {
        return { success: false, error: 'request_number_taken' };
      }
    }

    if (input.receivedAt && !isValidTimestamp(input.receivedAt)) {
      return { success: false, error: 'invalid_received_at' };
    }

    const { data, error } = await admin
      .from('client_requests')
      .insert({
        organization_id: orgId,
        request_number: requestNumber,
        client_id: clientId,
        contact_id: contactId,
        site_id: siteId,
        caller_name: input.callerName?.trim() || null,
        caller_phone: input.callerPhone?.trim() || null,
        caller_email: input.callerEmail?.trim() || null,
        caller_address: input.callerAddress?.trim() || null,
        summary,
        details: input.details?.trim() || null,
        category: input.category ?? 'sonstiges',
        urgency: input.urgency ?? 'normal',
        source: input.source ?? 'telefon',
        assigned_to: assignedTo,
        received_at: input.receivedAt || new Date().toISOString(),
        created_by: userId,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating client request:', error);
      if (error?.code === '23505') {
        return { success: false, error: 'request_number_taken' };
      }
      return { success: false, error: 'create_failed' };
    }

    await recordRequestEvent(admin, {
      orgId,
      requestId: data.id,
      eventType: 'created',
      eventPayload: {
        summary,
        category: data.category,
        urgency: data.urgency,
        source: data.source,
        clientId,
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.requests(orgId));
    return { success: true, request: toClientRequest(data) };
  } catch (error) {
    console.error('Unexpected error in createClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClientRequest(
  requestId: string,
  input: UpdateClientRequestInput
): Promise<ClientRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (!EDITABLE_STATUSES.includes(request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'request_not_editable' };
    }

    const updateData: Record<string, unknown> = {};

    if (input.summary !== undefined) {
      const summary = input.summary.trim();
      if (!summary) return { success: false, error: 'summary_required' };
      updateData.summary = summary;
    }
    if (input.details !== undefined) updateData.details = input.details?.trim() || null;
    if (input.callerName !== undefined)
      updateData.caller_name = input.callerName?.trim() || null;
    if (input.callerPhone !== undefined)
      updateData.caller_phone = input.callerPhone?.trim() || null;
    if (input.callerEmail !== undefined)
      updateData.caller_email = input.callerEmail?.trim() || null;
    if (input.callerAddress !== undefined)
      updateData.caller_address = input.callerAddress?.trim() || null;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.urgency !== undefined) updateData.urgency = input.urgency;
    if (input.source !== undefined) updateData.source = input.source;
    if (input.receivedAt !== undefined && input.receivedAt) {
      if (!isValidTimestamp(input.receivedAt)) {
        return { success: false, error: 'invalid_received_at' };
      }
      updateData.received_at = input.receivedAt;
    }
    if (input.status !== undefined) updateData.status = input.status;

    if (input.requestNumber !== undefined) {
      const requestNumber = input.requestNumber?.trim() || null;
      if (requestNumber && requestNumber !== request.requestNumber) {
        const { data: existingNumber } = await admin
          .from('client_requests')
          .select('id')
          .eq('organization_id', orgId)
          .eq('request_number', requestNumber)
          .neq('id', requestId)
          .maybeSingle();
        if (existingNumber) {
          return { success: false, error: 'request_number_taken' };
        }
      }
      updateData.request_number = requestNumber;
    }

    if (input.assignedTo !== undefined) {
      const assignedTo = input.assignedTo?.trim() || null;
      if (assignedTo && !(await validateAssignee(admin, orgId, assignedTo))) {
        return { success: false, error: 'assignee_not_found' };
      }
      updateData.assigned_to = assignedTo;
    }

    // Customer matching: changing the customer clears site/contact unless the
    // caller provides replacements that belong to the new customer (P1-01 rule).
    const clientChanged = input.clientId !== undefined;
    const effectiveClientId = clientChanged
      ? input.clientId || null
      : request.clientId;

    if (clientChanged) {
      if (effectiveClientId) {
        const { data: client } = await admin
          .from('clients')
          .select('id')
          .eq('id', effectiveClientId)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (!client) {
          return { success: false, error: 'client_not_found' };
        }
      }
      updateData.client_id = effectiveClientId;
      if (input.siteId === undefined) updateData.site_id = null;
      if (input.contactId === undefined) updateData.contact_id = null;
    }

    if (input.siteId !== undefined || input.contactId !== undefined) {
      const siteId =
        input.siteId !== undefined ? input.siteId || null : request.siteId;
      const contactId =
        input.contactId !== undefined ? input.contactId || null : request.contactId;
      const siteContactCheck = await validateSiteAndContactForClient(
        admin,
        orgId,
        effectiveClientId,
        input.siteId !== undefined ? siteId : null,
        input.contactId !== undefined ? contactId : null
      );
      if (!siteContactCheck.success) {
        return siteContactCheck;
      }
      if (input.siteId !== undefined) updateData.site_id = siteId;
      if (input.contactId !== undefined) updateData.contact_id = contactId;
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    const { data, error } = await admin
      .from('client_requests')
      .update(updateData)
      .eq('id', requestId)
      .eq('organization_id', orgId)
      .in('status', [...EDITABLE_STATUSES])
      .select()
      .single();

    if (error || !data) {
      console.error('Error updating client request:', error);
      return { success: false, error: 'update_failed' };
    }

    const eventType =
      clientChanged && effectiveClientId && !request.clientId
        ? 'matched'
        : input.status !== undefined && input.status !== request.status
          ? 'status_changed'
          : 'updated';

    await recordRequestEvent(admin, {
      orgId,
      requestId,
      eventType,
      eventPayload: { changedFields: Object.keys(updateData) },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.requests(orgId));
    return { success: true, request: toClientRequest(data) };
  } catch (error) {
    console.error('Unexpected error in updateClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// Promote an unknown caller into a customer record without retyping: the new
// customer is created from the captured caller fields and linked immediately.
export async function promoteCallerToClient(
  requestId: string,
  input?: { name?: string; clientType?: ClientType }
): Promise<ClientRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (!EDITABLE_STATUSES.includes(request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'request_not_editable' };
    }
    if (request.clientId) {
      return { success: false, error: 'already_matched' };
    }

    const name = input?.name?.trim() || request.callerName?.trim() || '';
    if (!name) {
      return { success: false, error: 'caller_name_required' };
    }

    const { data: client, error: clientError } = await admin
      .from('clients')
      .insert({
        organization_id: orgId,
        name,
        client_type: input?.clientType ?? 'privat',
        email: request.callerEmail,
        phone: request.callerPhone,
        address: request.callerAddress,
      })
      .select()
      .single();

    if (clientError || !client) {
      console.error('Error promoting caller to client:', clientError);
      return { success: false, error: 'promote_failed' };
    }

    const { data, error } = await admin
      .from('client_requests')
      .update({ client_id: client.id })
      .eq('id', requestId)
      .eq('organization_id', orgId)
      .is('client_id', null)
      .in('status', [...EDITABLE_STATUSES])
      .select()
      .single();

    if (error || !data) {
      // Roll the orphaned customer back so a concurrent match does not leave
      // an unused duplicate record behind.
      await admin.from('clients').delete().eq('id', client.id).eq('organization_id', orgId);
      console.error('Error linking promoted client to request:', error);
      return { success: false, error: 'promote_failed' };
    }

    await recordRequestEvent(admin, {
      orgId,
      requestId,
      eventType: 'promoted',
      eventPayload: { clientId: client.id, clientName: name },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.clients(orgId));
    updateTag(CACHE_TAGS.requests(orgId));
    return { success: true, request: toClientRequest(data) };
  } catch (error) {
    console.error('Unexpected error in promoteCallerToClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Close And Reopen
// ============================================

export async function closeClientRequest(
  requestId: string,
  input: { reason: RequestCloseReason; note?: string }
): Promise<ClientRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;

    if (
      !EDITABLE_STATUSES.includes(
        auth.request.status as (typeof EDITABLE_STATUSES)[number]
      )
    ) {
      return { success: false, error: 'request_not_editable' };
    }

    const { data, error } = await admin
      .from('client_requests')
      .update({
        status: 'geschlossen',
        closed_reason: input.reason,
        closed_note: input.note?.trim() || null,
        closed_by: userId,
        closed_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('organization_id', orgId)
      .in('status', [...EDITABLE_STATUSES])
      .select()
      .single();

    if (error || !data) {
      console.error('Error closing client request:', error);
      return { success: false, error: 'close_failed' };
    }

    await recordRequestEvent(admin, {
      orgId,
      requestId,
      eventType: 'closed',
      eventPayload: { reason: input.reason, note: input.note?.trim() || null },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.requests(orgId));
    return { success: true, request: toClientRequest(data) };
  } catch (error) {
    console.error('Unexpected error in closeClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function reopenClientRequest(
  requestId: string
): Promise<ClientRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (request.status !== 'geschlossen') {
      return { success: false, error: 'request_not_closed' };
    }

    const { data, error } = await admin
      .from('client_requests')
      .update({
        status: 'offen',
        closed_reason: null,
        closed_note: null,
        closed_by: null,
        closed_at: null,
      })
      .eq('id', requestId)
      .eq('organization_id', orgId)
      .eq('status', 'geschlossen')
      .select()
      .single();

    if (error || !data) {
      console.error('Error reopening client request:', error);
      return { success: false, error: 'reopen_failed' };
    }

    await recordRequestEvent(admin, {
      orgId,
      requestId,
      eventType: 'reopened',
      eventPayload: {
        previousReason: request.closedReason,
        previousNote: request.closedNote,
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.requests(orgId));
    return { success: true, request: toClientRequest(data) };
  } catch (error) {
    console.error('Unexpected error in reopenClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Conversion (once-only, race-safe)
// ============================================

// Marks the request as converted with a single compare-and-set update. Only
// one concurrent conversion can win; everyone else sees zero updated rows.
async function claimRequestConversion(
  admin: AdminClient,
  input: {
    orgId: string;
    requestId: string;
    userId: string;
    jobId?: string;
    projectId?: string;
  }
): Promise<boolean> {
  const { data, error } = await admin
    .from('client_requests')
    .update({
      status: 'umgewandelt',
      converted_job_id: input.jobId ?? null,
      converted_project_id: input.projectId ?? null,
      converted_by: input.userId,
      converted_at: new Date().toISOString(),
    })
    .eq('id', input.requestId)
    .eq('organization_id', input.orgId)
    .in('status', [...EDITABLE_STATUSES])
    .is('converted_job_id', null)
    .is('converted_project_id', null)
    .select('id');

  if (error) {
    console.error('Error claiming request conversion:', error);
    return false;
  }

  return (data ?? []).length === 1;
}

// Carries the request's attachments into the converted work by adding a second
// metadata link per document — same bytes, no copies; the request link stays.
async function linkRequestDocumentsToWork(
  admin: AdminClient,
  input: {
    orgId: string;
    requestId: string;
    userId: string;
    jobId?: string;
    projectId?: string;
  }
): Promise<void> {
  const { data: links, error } = await admin
    .from('document_links')
    .select('document_id')
    .eq('organization_id', input.orgId)
    .eq('request_id', input.requestId);

  if (error) {
    console.error('Failed to load request attachments for conversion:', error);
    return;
  }

  const documentIds = Array.from(
    new Set((links ?? []).map((link) => link.document_id))
  );
  if (documentIds.length === 0) return;

  for (const documentId of documentIds) {
    const { error: insertError } = await admin.from('document_links').insert({
      organization_id: input.orgId,
      document_id: documentId,
      job_id: input.jobId ?? null,
      project_id: input.projectId ?? null,
      created_by: input.userId,
    });

    if (insertError) {
      console.error('Failed to link request attachment to work:', insertError);
      continue;
    }

    await admin.from('document_audit_events').insert({
      organization_id: input.orgId,
      document_id: documentId,
      actor_id: input.userId,
      event_type: 'linked',
      event_payload: {
        jobId: input.jobId ?? null,
        projectId: input.projectId ?? null,
        requestId: input.requestId,
        via: 'request_conversion',
      },
    });
  }

  updateTag(CACHE_TAGS.documents(input.orgId));
}

export async function convertRequestToJob(
  requestId: string,
  input: CreateJobInput
): Promise<ConvertRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (!EDITABLE_STATUSES.includes(request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'already_converted' };
    }

    // P1-02 converts into a standalone job or a project; attaching a request
    // to existing work is a later triage capability (service slices).
    if (input.projectId) {
      return { success: false, error: 'standalone_job_only' };
    }

    // Owner-approved rule: conversion requires a resolved customer. The dialog
    // lets the user match or create one inline.
    if (!input.clientId) {
      return { success: false, error: 'client_required' };
    }

    // P1-01 snapshot rule: selecting a site records its current address as the
    // job's free-text Ort. The dialog fills this when the user changes the
    // site; for the prefilled request site the server supplies the snapshot.
    const jobInput: CreateJobInput = { ...input };
    if (jobInput.siteId && !jobInput.location?.trim()) {
      const { data: site } = await admin
        .from('client_sites')
        .select('street, postal_code, city')
        .eq('id', jobInput.siteId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (site) {
        const cityLine = [site.postal_code, site.city].filter(Boolean).join(' ');
        const address = [site.street, cityLine].filter(Boolean).join(', ');
        if (address) jobInput.location = address;
      }
    }

    const created = await createJob(jobInput);
    if (!created.success) return created;

    const claimed = await claimRequestConversion(admin, {
      orgId,
      requestId,
      userId,
      jobId: created.job.id,
    });

    if (!claimed) {
      // A concurrent conversion won; remove the work this attempt created so
      // no duplicate job remains.
      const { error: rollbackError } = await admin
        .from('jobs')
        .delete()
        .eq('id', created.job.id)
        .eq('organization_id', orgId);
      if (rollbackError) {
        console.error(
          'Failed to roll back job after losing conversion race:',
          rollbackError
        );
      }
      updateTag(CACHE_TAGS.jobs(orgId));
      return { success: false, error: 'already_converted' };
    }

    await linkRequestDocumentsToWork(admin, {
      orgId,
      requestId,
      userId,
      jobId: created.job.id,
    });

    await recordRequestEvent(admin, {
      orgId,
      requestId,
      eventType: 'converted',
      eventPayload: {
        target: 'job',
        jobId: created.job.id,
        jobNumber: created.job.jobNumber,
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.requests(orgId));
    return {
      success: true,
      target: 'job',
      jobId: created.job.id,
      jobNumber: created.job.jobNumber,
    };
  } catch (error) {
    console.error('Unexpected error in convertRequestToJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function convertRequestToProject(
  requestId: string,
  input: CreateProjectInput
): Promise<ConvertRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (!EDITABLE_STATUSES.includes(request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'already_converted' };
    }

    if (!input.clientId) {
      return { success: false, error: 'client_required' };
    }

    const created = await createProject(input);
    if (!created.success) return created;

    const claimed = await claimRequestConversion(admin, {
      orgId,
      requestId,
      userId,
      projectId: created.project.id,
    });

    if (!claimed) {
      const { error: rollbackError } = await admin
        .from('projects')
        .delete()
        .eq('id', created.project.id)
        .eq('organization_id', orgId);
      if (rollbackError) {
        console.error(
          'Failed to roll back project after losing conversion race:',
          rollbackError
        );
      }
      updateTag(CACHE_TAGS.projects(orgId));
      return { success: false, error: 'already_converted' };
    }

    await linkRequestDocumentsToWork(admin, {
      orgId,
      requestId,
      userId,
      projectId: created.project.id,
    });

    await recordRequestEvent(admin, {
      orgId,
      requestId,
      eventType: 'converted',
      eventPayload: {
        target: 'project',
        projectId: created.project.id,
        projectNumber: created.project.projectNumber,
      },
      actorId: userId,
    });

    updateTag(CACHE_TAGS.requests(orgId));
    return {
      success: true,
      target: 'project',
      projectId: created.project.id,
      projectNumber: created.project.projectNumber,
    };
  } catch (error) {
    console.error('Unexpected error in convertRequestToProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Lookups
// ============================================

export async function getNextRequestNumber(): Promise<
  { success: true; requestNumber: string } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('generate_request_number', {
      p_org_id: auth.context.orgId,
    });

    if (error || !data) {
      console.error('Error generating request number:', error);
      return { success: false, error: 'generation_failed' };
    }

    return { success: true, requestNumber: data as string };
  } catch (error) {
    console.error('Unexpected error in getNextRequestNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getRequestDetail(
  requestId: string
): Promise<ClientRequestResult> {
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    return { success: true, request: auth.request };
  } catch (error) {
    console.error('Unexpected error in getRequestDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
