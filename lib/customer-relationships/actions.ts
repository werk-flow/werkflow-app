'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { requireManagerAndClient, type ClientManagerContext } from '@/lib/clients/manager-access';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import {
  loadFollowUpOwners,
  loadFollowUps,
  loadSingleFollowUpSource,
  toClientFollowUp,
} from './follow-up-reads';
import { resolveCommunicationGuidance } from './resolution';
import {
  communicationExceptionInputSchema,
  communicationGuidanceInputSchema,
  communicationPreferenceInputSchema,
  communicationSettingsInputSchema,
  followUpInputSchema,
  followUpTransitionSchema,
} from './schemas';
import { loadTimeline } from './timeline-reads';
import {
  preferenceFromRow,
  settingsFromRow,
  toFollowUpSourceType,
  type ClientFollowUp,
  type CommunicationChannel,
  type CommunicationPreference,
  type CommunicationPreferenceInput,
  type CommunicationPurpose,
  type CommunicationSettings,
  type CommunicationSettingsInput,
  type CustomerRelationshipBundle,
  type FollowUpInput,
  type FollowUpStatus,
  type RelationshipActionResult,
} from './types';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

async function loadCommunicationConfiguration(
  context: ClientManagerContext,
  clientId: string,
): Promise<
  | {
      success: true;
      settings: CommunicationSettings | null;
      preferences: CommunicationPreference[];
    }
  | ActionFailure
> {
  const [settingsResult, preferencesResult] = await Promise.all([
    context.admin
      .from('client_communication_settings')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .maybeSingle(),
    context.admin
      .from('client_communication_preferences')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq('client_id', clientId)
      .order('contact_id', { ascending: true, nullsFirst: true })
      .order('channel', { ascending: true })
      .order('purpose', { ascending: true })
      .limit(251),
  ]);
  if (settingsResult.error || preferencesResult.error) {
    logReadFailure(
      'loadCommunicationConfiguration: communication read failed',
      settingsResult.error ?? preferencesResult.error,
    );
    return { success: false, error: 'communication_preferences_load_failed' };
  }
  if ((preferencesResult.data ?? []).length > 250) {
    logReadFailure('loadCommunicationConfiguration: preferences of one customer exceeded 250', {
      code: 'communication_preferences_capacity_exceeded',
      clientId,
    });
    return { success: false, error: 'communication_preferences_capacity_exceeded' };
  }
  return {
    success: true,
    settings: settingsResult.data ? settingsFromRow(settingsResult.data) : null,
    preferences: (preferencesResult.data ?? []).map(preferenceFromRow),
  };
}

// The ids and the timeline cursor a client sends, bounded before any read.
const relationshipTargetSchema = z.object({
  clientId: uuidSchema,
  followUpId: uuidSchema.optional(),
  cursor: z.string().max(2000).nullish(),
});

export async function getCustomerRelationshipBundle(
  rawClientId: string,
  rawCursor?: string | null,
): Promise<ActionResult<{ data: CustomerRelationshipBundle }>> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId, cursor: rawCursor });
  if (!target.success) return { success: false, error: 'input_invalid' };
  const { clientId, cursor } = target.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const [ownersResult, timelineResult, communicationResult] = await Promise.all([
    loadFollowUpOwners(auth.context),
    loadTimeline(auth.context, clientId, cursor),
    loadCommunicationConfiguration(auth.context, clientId),
  ]);
  if (!ownersResult.success) return ownersResult;
  if (!timelineResult.success) return timelineResult;
  if (!communicationResult.success) return communicationResult;
  const followUpsResult = await loadFollowUps(
    auth.context,
    clientId,
    ownersResult.owners,
    ownersResult.managerUserIds,
  );
  if (!followUpsResult.success) return followUpsResult;
  return {
    success: true,
    data: {
      timeline: timelineResult.timeline,
      followUps: followUpsResult.followUps,
      followUpOwners: ownersResult.owners,
      communicationSettings: communicationResult.settings,
      communicationPreferences: communicationResult.preferences,
    },
  };
}

export async function createCustomerFollowUp(
  rawClientId: string,
  input: FollowUpInput,
): Promise<RelationshipActionResult<ClientFollowUp>> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = followUpInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('create_client_follow_up', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_title: validatedInput.title,
    p_note: validatedInput.note ?? '',
    p_owner_user_id: validatedInput.ownerUserId,
    p_due_at: new Date(validatedInput.dueAt).toISOString(),
    p_source_type: validatedInput.sourceType ?? null,
    p_source_id: validatedInput.sourceId ?? null,
    p_actor_id: auth.context.userId,
  });
  const { data, error } = await auth.context.admin.rpc('create_client_follow_up', args);
  if (error || !data) {
    logError('Failed to create customer follow-up:', error);
    return { success: false, error: 'create_failed' };
  }
  if (data.status !== 'open') {
    return { success: false, error: 'create_failed' };
  }
  const [ownersResult, sourceResult] = await Promise.all([
    loadFollowUpOwners(auth.context),
    loadSingleFollowUpSource(
      auth.context,
      clientId,
      data.source_type === null ? null : toFollowUpSourceType(data.source_type),
      data.source_id,
    ),
  ]);
  if (!ownersResult.success || !sourceResult.success) {
    return { success: false, error: 'reload_failed' };
  }
  const owner = ownersResult.owners.find((candidate) => candidate.userId === data.owner_user_id);
  return {
    success: true,
    data: toClientFollowUp(
      data,
      owner?.name ?? 'Ehemalige Zuständigkeit',
      ownersResult.managerUserIds.has(data.owner_user_id),
      sourceResult.source,
    ),
  };
}

export async function updateCustomerFollowUp(
  rawClientId: string,
  rawFollowUpId: string,
  input: FollowUpInput,
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema
    .required({ followUpId: true })
    .safeParse({ clientId: rawClientId, followUpId: rawFollowUpId });
  const parsed = followUpInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId, followUpId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('update_client_follow_up', {
    p_follow_up_id: followUpId,
    p_organization_id: auth.context.orgId,
    p_title: validatedInput.title,
    p_note: validatedInput.note ?? '',
    p_owner_user_id: validatedInput.ownerUserId,
    p_due_at: new Date(validatedInput.dueAt).toISOString(),
    p_source_type: validatedInput.sourceType ?? null,
    p_source_id: validatedInput.sourceId ?? null,
    p_actor_id: auth.context.userId,
    p_reason: validatedInput.reason ?? null,
  });
  const { error } = await auth.context.admin.rpc('update_client_follow_up', args);
  if (error) {
    logError('Failed to update customer follow-up:', error);
    return { success: false, error: 'update_failed' };
  }
  return { success: true };
}

export async function transitionCustomerFollowUp(
  rawClientId: string,
  rawFollowUpId: string,
  targetStatus: FollowUpStatus,
  input: { resolutionNote?: string; reason?: string } = {},
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema
    .required({ followUpId: true })
    .safeParse({ clientId: rawClientId, followUpId: rawFollowUpId });
  const parsed = followUpTransitionSchema.safeParse({ targetStatus, ...input });
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId, followUpId } = target.data;
  const validatedInput = parsed.data;
  if (validatedInput.targetStatus === 'open' && !validatedInput.reason?.trim()) {
    return { success: false, error: 'reason_required' };
  }
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('transition_client_follow_up', {
    p_follow_up_id: followUpId,
    p_organization_id: auth.context.orgId,
    p_target_status: validatedInput.targetStatus,
    p_resolution_note: validatedInput.resolutionNote ?? '',
    p_actor_id: auth.context.userId,
    p_reason: validatedInput.reason ?? null,
  });
  const { error } = await auth.context.admin.rpc('transition_client_follow_up', args);
  if (error) {
    logError('Failed to transition customer follow-up:', error);
    return { success: false, error: 'transition_failed' };
  }
  return { success: true };
}

export async function saveCustomerCommunicationSettings(
  rawClientId: string,
  input: CommunicationSettingsInput,
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationSettingsInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('save_client_communication_settings', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_preferred_contact_id: validatedInput.preferredContactId ?? null,
    p_preferred_channel: validatedInput.preferredChannel ?? null,
    p_do_not_contact_instruction: validatedInput.doNotContactInstruction ?? '',
    p_contact_time_note: validatedInput.contactTimeNote ?? '',
    p_language_note: validatedInput.languageNote ?? '',
    p_accessibility_note: validatedInput.accessibilityNote ?? '',
    p_source_note: validatedInput.sourceNote ?? '',
    p_actor_id: auth.context.userId,
  });
  const { error } = await auth.context.admin.rpc('save_client_communication_settings', args);
  if (error) {
    logError('Failed to save communication settings:', error);
    return { success: false, error: 'save_failed' };
  }
  return { success: true };
}

export async function saveCustomerCommunicationPreference(
  rawClientId: string,
  input: CommunicationPreferenceInput,
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationPreferenceInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const validatedInput = parsed.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const args = rpcArgs('set_client_communication_preference', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_contact_id: validatedInput.contactId ?? null,
    p_channel: validatedInput.channel,
    p_purpose: validatedInput.purpose,
    p_state: validatedInput.state,
    p_source_note: validatedInput.sourceNote ?? '',
    p_actor_id: auth.context.userId,
  });
  const { error } = await auth.context.admin.rpc('set_client_communication_preference', args);
  if (error) {
    logError('Failed to save communication preference:', error);
    return { success: false, error: 'save_failed' };
  }
  return { success: true };
}

async function evaluateCommunicationGuidanceForContext(
  context: ClientManagerContext,
  clientId: string,
  input: {
    contactId: string | null;
    channel: CommunicationChannel;
    purpose: CommunicationPurpose;
  },
): Promise<RelationshipActionResult<ReturnType<typeof resolveCommunicationGuidance>>> {
  const configuration = await loadCommunicationConfiguration(context, clientId);
  if (!configuration.success) return configuration;
  return {
    success: true,
    data: resolveCommunicationGuidance({
      ...input,
      settings: configuration.settings,
      preferences: configuration.preferences,
    }),
  };
}

export async function evaluateCustomerCommunicationGuidance(
  rawClientId: string,
  input: {
    contactId: string | null;
    channel: CommunicationChannel;
    purpose: CommunicationPurpose;
  },
): Promise<RelationshipActionResult<ReturnType<typeof resolveCommunicationGuidance>>> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationGuidanceInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  return evaluateCommunicationGuidanceForContext(auth.context, clientId, parsed.data);
}

export async function recordCustomerCommunicationException(
  rawClientId: string,
  input: {
    contactId: string | null;
    channel: CommunicationChannel;
    purpose: CommunicationPurpose;
    reason: string;
  },
): Promise<RelationshipActionResult> {
  const target = relationshipTargetSchema.safeParse({ clientId: rawClientId });
  const parsed = communicationExceptionInputSchema.safeParse(input);
  if (!target.success || !parsed.success) return { success: false, error: 'input_invalid' };
  const { clientId } = target.data;
  const auth = await requireManagerAndClient(clientId);
  if (!auth.success) return auth;
  const guidanceResult = await evaluateCommunicationGuidanceForContext(auth.context, clientId, parsed.data);
  if (!guidanceResult.success) return guidanceResult;
  if (guidanceResult.data.warnings.length === 0) {
    return { success: false, error: 'exception_not_required' };
  }
  const args = rpcArgs('record_client_communication_exception', {
    p_organization_id: auth.context.orgId,
    p_client_id: clientId,
    p_contact_id: parsed.data.contactId,
    p_channel: parsed.data.channel,
    p_purpose: parsed.data.purpose,
    p_warnings: guidanceResult.data.warnings,
    p_reason: parsed.data.reason,
    p_actor_id: auth.context.userId,
  });
  const { error } = await auth.context.admin.rpc('record_client_communication_exception', args);
  if (error) {
    logError('Failed to record communication exception:', error);
    return { success: false, error: 'save_failed' };
  }
  return { success: true };
}
