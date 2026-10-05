'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { CreateJobInput } from '@/lib/jobs/actions';
import { JOB_CREATION_REFUSALS, prepareJobCreation } from '@/lib/jobs/creation';
import type { CreateProjectInput } from '@/lib/projects/actions';
import { PROJECT_CREATION_REFUSALS, projectCreationColumns } from '@/lib/projects/creation';
import { workWriteFailure } from '@/lib/jobs/write-refusals';
import { CACHE_TAGS } from '@/lib/data/cached';
import { updateTag } from 'next/cache';
import type { ClientType } from '@/lib/jobs/types';
import {
  type ClientRequest,
  type ClientRequestResult,
  type ClientRequestRow,
  type ConvertRequestResult,
  type RequestCategory,
  type RequestCloseReason,
  type RequestSource,
  type RequestUrgency,
  toClientRequest,
} from '@/lib/requests/types';
import { logError } from '@/lib/logging';
import { blankableUuidSchema, createJobInputSchema } from '@/lib/jobs/action-schemas';
import { createProjectInputSchema } from '@/lib/projects/action-schemas';
import { Constants, type Json } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isUuid, uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

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

// Boundary schemas: the arguments arrive from the network unchecked. Blank ids
// keep their meaning (no reference); blank summaries reach `summary_required`.
const requestFieldsSchema = z.object({
  summary: z.string().max(2000),
  details: z.string().max(20_000).nullish(),
  requestNumber: z.string().max(100).nullish(),
  callerName: z.string().max(300).nullish(),
  callerPhone: z.string().max(100).nullish(),
  callerEmail: z.string().max(320).nullish(),
  callerAddress: z.string().max(1000).nullish(),
  category: z.enum(Constants.public.Enums.request_category).optional(),
  urgency: z.enum(Constants.public.Enums.request_urgency).optional(),
  source: z.enum(Constants.public.Enums.request_source).optional(),
  // Not a uuid schema: an unknown assignee keeps its own code, assignee_not_found.
  assignedTo: z.string().max(100).nullish(),
  receivedAt: z.string().max(64).nullish(),
});
const createRequestInputSchema = requestFieldsSchema.extend({
  clientId: blankableUuidSchema.optional(),
  contactId: blankableUuidSchema.optional(),
  siteId: blankableUuidSchema.optional(),
});
const updateRequestArgumentsSchema = z.object({
  requestId: uuidSchema,
  input: requestFieldsSchema.partial().extend({
    clientId: blankableUuidSchema.nullish(),
    contactId: blankableUuidSchema.nullish(),
    siteId: blankableUuidSchema.nullish(),
    status: z.enum(EDITABLE_STATUSES).optional(),
  }),
});
const promoteCallerArgumentsSchema = z.object({
  requestId: uuidSchema,
  input: z
    .object({
      name: z.string().max(300).optional(),
      clientType: z.enum(Constants.public.Enums.client_type).optional(),
    })
    .optional(),
});
const closeRequestArgumentsSchema = z.object({
  requestId: uuidSchema,
  input: z.object({
    reason: z.enum(Constants.public.Enums.request_close_reason),
    note: z.string().max(2000).optional(),
  }),
});
// projectId is only checked for presence: any value is refused with
// standalone_job_only.
const convertToJobArgumentsSchema = z.object({
  requestId: uuidSchema,
  input: createJobInputSchema.extend({ projectId: z.string().max(100).nullish() }),
});
const convertToProjectArgumentsSchema = z.object({
  requestId: uuidSchema,
  input: createProjectInputSchema,
});

async function requireManagerAndRequest(requestId: string): Promise<
  | {
      success: true;
      context: { orgId: string; userId: string; admin: AdminClient };
      request: ClientRequest;
    }
  | ActionFailure
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

  if (error && error.code !== 'PGRST116')
    logReadFailure('requireManagerAndRequest: request read failed', error);
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

// The refusals of create_client_request, update_client_request,
// close_client_request and reopen_client_request, each an action failure code.
const REQUEST_WRITE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'request_not_found',
  'not_authorized',
  'request_not_editable',
  'request_not_closed',
  'summary_required',
  'request_number_taken',
  'client_not_found',
  'site_requires_client',
  'site_not_found',
  'site_client_mismatch',
  'contact_requires_client',
  'contact_not_found',
  'contact_client_mismatch',
  'assignee_not_found',
]);

// The result of one request write function: the saved request, the refusal
// raised under the lock, or the action's own failure code for anything else.
function requestWriteResult(
  outcome: { data: ClientRequestRow | null; error: { message: string } | null },
  failureCode: string,
  logLabel: string,
): ClientRequestResult {
  if (outcome.error && REQUEST_WRITE_REFUSALS.has(outcome.error.message)) {
    return { success: false, error: outcome.error.message };
  }
  if (outcome.error || !outcome.data) {
    logError(logLabel, outcome.error);
    return { success: false, error: failureCode };
  }
  return { success: true, request: toClientRequest(outcome.data) };
}

// ============================================
// Capture And Maintain
// ============================================

export async function createClientRequest(rawInput: CreateClientRequestInput): Promise<ClientRequestResult> {
  const parsedInput = createRequestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
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

    const assignedTo = input.assignedTo?.trim() || null;
    if (assignedTo && !isUuid(assignedTo)) {
      return { success: false, error: 'assignee_not_found' };
    }

    if (input.receivedAt && !isValidTimestamp(input.receivedAt)) {
      return { success: false, error: 'invalid_received_at' };
    }

    // One call checks the customer references, the assignee and the number
    // under lock, stores the request and records its 'created' history row, or
    // refuses with one of REQUEST_WRITE_REFUSALS and changes nothing.
    const admin = createSupabaseAdminClient();
    const outcome = await admin.rpc(
      'create_client_request',
      rpcArgs('create_client_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_summary: summary,
        p_details: input.details?.trim() || null,
        p_request_number: input.requestNumber?.trim() || null,
        p_client_id: input.clientId?.trim() || null,
        p_site_id: input.siteId?.trim() || null,
        p_contact_id: input.contactId?.trim() || null,
        p_caller_name: input.callerName?.trim() || null,
        p_caller_phone: input.callerPhone?.trim() || null,
        p_caller_email: input.callerEmail?.trim() || null,
        p_caller_address: input.callerAddress?.trim() || null,
        p_category: input.category ?? 'sonstiges',
        p_urgency: input.urgency ?? 'normal',
        p_source: input.source ?? 'telefon',
        p_assigned_to: assignedTo,
        p_received_at: input.receivedAt || null,
      }),
    );
    return requestWriteResult(outcome, 'create_failed', 'Error creating client request:');
  } catch (error) {
    logError('Unexpected error in createClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateClientRequest(
  rawRequestId: string,
  rawInput: UpdateClientRequestInput,
): Promise<ClientRequestResult> {
  const parsedArguments = updateRequestArgumentsSchema.safeParse({
    requestId: rawRequestId,
    input: rawInput,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, input } = parsedArguments.data;
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (!EDITABLE_STATUSES.includes(request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'request_not_editable' };
    }

    // The columns to save, keyed by column name; update_client_request saves
    // only these and refuses any other key.
    const changes: { [column: string]: Json } = {};

    if (input.summary !== undefined) {
      const summary = input.summary.trim();
      if (!summary) return { success: false, error: 'summary_required' };
      changes.summary = summary;
    }
    if (input.details !== undefined) changes.details = input.details?.trim() || null;
    if (input.callerName !== undefined) changes.caller_name = input.callerName?.trim() || null;
    if (input.callerPhone !== undefined) changes.caller_phone = input.callerPhone?.trim() || null;
    if (input.callerEmail !== undefined) changes.caller_email = input.callerEmail?.trim() || null;
    if (input.callerAddress !== undefined) changes.caller_address = input.callerAddress?.trim() || null;
    if (input.category !== undefined) changes.category = input.category;
    if (input.urgency !== undefined) changes.urgency = input.urgency;
    if (input.source !== undefined) changes.source = input.source;
    if (input.receivedAt !== undefined && input.receivedAt) {
      if (!isValidTimestamp(input.receivedAt)) {
        return { success: false, error: 'invalid_received_at' };
      }
      changes.received_at = input.receivedAt;
    }
    if (input.status !== undefined) changes.status = input.status;
    if (input.requestNumber !== undefined) changes.request_number = input.requestNumber?.trim() || null;

    if (input.assignedTo !== undefined) {
      const assignedTo = input.assignedTo?.trim() || null;
      if (assignedTo && !isUuid(assignedTo)) {
        return { success: false, error: 'assignee_not_found' };
      }
      changes.assigned_to = assignedTo;
    }

    // Customer matching: changing the customer clears site/contact unless the
    // caller provides replacements that belong to the new customer.
    if (input.clientId !== undefined) {
      changes.client_id = input.clientId || null;
      changes.site_id = null;
      changes.contact_id = null;
    }
    if (input.siteId !== undefined) changes.site_id = input.siteId || null;
    if (input.contactId !== undefined) changes.contact_id = input.contactId || null;

    if (Object.keys(changes).length === 0) {
      return { success: false, error: 'no_changes' };
    }

    // One call checks the references, the assignee and the number under lock,
    // saves the columns and records the 'matched', 'status_changed' or
    // 'updated' history row, or refuses and changes nothing.
    const outcome = await admin.rpc(
      'update_client_request',
      rpcArgs('update_client_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: requestId,
        p_changes: changes,
      }),
    );
    return requestWriteResult(outcome, 'update_failed', 'Error updating client request:');
  } catch (error) {
    logError('Unexpected error in updateClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// The refusals of promote_client_request_caller, each an action failure code.
const PROMOTE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'request_not_found',
  'not_authorized',
  'request_not_editable',
  'already_matched',
  'caller_name_required',
]);

// Promote an unknown caller into a customer record without retyping: the new
// customer is created from the captured caller fields and linked immediately.
export async function promoteCallerToClient(
  rawRequestId: string,
  rawInput?: { name?: string; clientType?: ClientType },
): Promise<ClientRequestResult> {
  const parsedArguments = promoteCallerArgumentsSchema.safeParse({
    requestId: rawRequestId,
    input: rawInput,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, input } = parsedArguments.data;
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

    // One call creates the customer, links it and records the history row,
    // or refuses with one of PROMOTE_REFUSALS and changes nothing.
    const { data, error } = await admin.rpc(
      'promote_client_request_caller',
      rpcArgs('promote_client_request_caller', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: requestId,
        p_name: name,
        p_client_type: input?.clientType ?? 'privat',
      }),
    );

    if (error || !data) {
      if (error && PROMOTE_REFUSALS.has(error.message)) return { success: false, error: error.message };
      logError('Error promoting caller to client:', error);
      return { success: false, error: 'promote_failed' };
    }

    return { success: true, request: toClientRequest(data) };
  } catch (error) {
    logError('Unexpected error in promoteCallerToClient:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Close And Reopen
// ============================================

export async function closeClientRequest(
  rawRequestId: string,
  rawInput: { reason: RequestCloseReason; note?: string },
): Promise<ClientRequestResult> {
  const parsedArguments = closeRequestArgumentsSchema.safeParse({ requestId: rawRequestId, input: rawInput });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, input } = parsedArguments.data;
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;

    if (!EDITABLE_STATUSES.includes(auth.request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'request_not_editable' };
    }

    // One call closes the request and records its 'closed' history row.
    const outcome = await admin.rpc(
      'close_client_request',
      rpcArgs('close_client_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: requestId,
        p_reason: input.reason,
        p_note: input.note?.trim() || null,
      }),
    );
    return requestWriteResult(outcome, 'close_failed', 'Error closing client request:');
  } catch (error) {
    logError('Unexpected error in closeClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function reopenClientRequest(rawRequestId: string): Promise<ClientRequestResult> {
  const parsedRequestId = uuidSchema.safeParse(rawRequestId);
  if (!parsedRequestId.success) return { success: false, error: 'invalid_input' };
  const requestId = parsedRequestId.data;
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;

    if (auth.request.status !== 'geschlossen') {
      return { success: false, error: 'request_not_closed' };
    }

    // One call reopens the request and records its 'reopened' history row
    // with the reason and note it had under the lock.
    const outcome = await admin.rpc(
      'reopen_client_request',
      rpcArgs('reopen_client_request', {
        p_actor_id: userId,
        p_organization_id: orgId,
        p_request_id: requestId,
      }),
    );
    return requestWriteResult(outcome, 'reopen_failed', 'Error reopening client request:');
  } catch (error) {
    logError('Unexpected error in reopenClientRequest:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Conversion (once-only, race-safe)
// ============================================

// The refusals of the conversion functions on top of the work creation ones.
const CONVERSION_REFUSALS = [
  'request_not_found',
  'already_converted',
  'standalone_job_only',
  'client_required',
];

// A request converts into a standalone job or a project of a customer, once.
// One call creates the work, marks the request converted under its lock,
// carries the request's documents into the work as second links (same bytes,
// no copies) with their audit events and records the history row, or
// changes nothing; a concurrent conversion waits and refuses.
export async function convertRequestToJob(
  rawRequestId: string,
  rawInput: CreateJobInput,
): Promise<ConvertRequestResult> {
  const parsedArguments = convertToJobArgumentsSchema.safeParse({ requestId: rawRequestId, input: rawInput });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, input } = parsedArguments.data;
  try {
    const auth = await requireManagerAndRequest(requestId);
    if (!auth.success) return auth;
    const { orgId, userId, admin } = auth.context;
    const { request } = auth;

    if (!EDITABLE_STATUSES.includes(request.status as (typeof EDITABLE_STATUSES)[number])) {
      return { success: false, error: 'already_converted' };
    }

    // Attaching a request to existing work is a later triage capability
    // (service slices).
    if (input.projectId) {
      return { success: false, error: 'standalone_job_only' };
    }

    // Owner-approved rule: conversion requires a resolved customer. The dialog
    // lets the user match or create one inline.
    if (!input.clientId) {
      return { success: false, error: 'client_required' };
    }

    const prepared = await prepareJobCreation(
      { admin, orgId, actorId: userId },
      input,
      input.jobNumber ?? '',
    );
    if (!prepared.success) return prepared;

    const { data, error } = await admin.rpc(
      'convert_client_request_to_job',
      rpcArgs('convert_client_request_to_job', {
        ...prepared.arguments,
        p_organization_id: orgId,
        p_actor_id: userId,
        p_request_id: requestId,
      }),
    );
    if (error) {
      return workWriteFailure(
        'Error converting request to job:',
        error,
        [...CONVERSION_REFUSALS, ...JOB_CREATION_REFUSALS],
        'create_failed',
      );
    }

    updateTag(CACHE_TAGS.workTemplates(orgId));

    return { success: true, target: 'job', jobId: data.id, jobNumber: data.job_number };
  } catch (error) {
    logError('Unexpected error in convertRequestToJob:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function convertRequestToProject(
  rawRequestId: string,
  rawInput: CreateProjectInput,
): Promise<ConvertRequestResult> {
  const parsedArguments = convertToProjectArgumentsSchema.safeParse({
    requestId: rawRequestId,
    input: rawInput,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, input } = parsedArguments.data;
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

    const { data, error } = await admin.rpc(
      'convert_client_request_to_project',
      rpcArgs('convert_client_request_to_project', {
        p_organization_id: orgId,
        p_actor_id: userId,
        p_request_id: requestId,
        p_project: projectCreationColumns(input),
        p_template_version_id: input.templateVersionId || null,
      }),
    );
    if (error) {
      return workWriteFailure(
        'Error converting request to project:',
        error,
        [...CONVERSION_REFUSALS, ...PROJECT_CREATION_REFUSALS],
        'create_failed',
      );
    }

    updateTag(CACHE_TAGS.workTemplates(orgId));

    return {
      success: true,
      target: 'project',
      projectId: data.id,
      projectNumber: data.project_number,
    };
  } catch (error) {
    logError('Unexpected error in convertRequestToProject:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

// ============================================
// Lookups
// ============================================

export async function getNextRequestNumber(): Promise<ActionResult<{ requestNumber: string }>> {
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
      logError('Error generating request number:', error);
      return { success: false, error: 'generation_failed' };
    }

    return { success: true, requestNumber: data as string };
  } catch (error) {
    logError('Unexpected error in getNextRequestNumber:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
