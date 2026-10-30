import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { toProfileReference, type ProfileReferenceRow } from '@/lib/profile-reference';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import {
  toJobInstructionItem,
  type JobInstructionItemRow,
  type JobInstructionItemWithDetails,
} from './types';

/** The people, evidence requirements and predecessors of the rows; null after a logged failed read. */
async function readInstructionItemMetadata(admin: AdminClient, orgId: string, rows: JobInstructionItemRow[]) {
  const profileIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        [row.created_by, row.last_status_changed_by].filter((value): value is string => Boolean(value)),
      ),
    ),
  );

  const itemIds = rows.map((row) => row.id);

  // Each batch holds whole items, so the per-item `sort_order` survives batching.
  const [profilesResult, evidenceResult, dependencyResult] = await Promise.all([
    readInBatches(profileIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', [...batch]),
    ),
    readInBatches(itemIds, (batch) =>
      admin
        .from('job_instruction_item_evidence_requirements')
        .select('id, instruction_item_id, description, document_category')
        .eq('organization_id', orgId)
        .in('instruction_item_id', [...batch])
        .order('sort_order'),
    ),
    readInBatches(itemIds, (batch) =>
      admin
        .from('job_instruction_item_dependencies')
        .select('dependent_item_id, predecessor_item_id')
        .eq('organization_id', orgId)
        .in('dependent_item_id', [...batch]),
    ),
  ]);
  const metadataError = profilesResult.error ?? evidenceResult.error ?? dependencyResult.error;
  if (metadataError) {
    logReadFailure('hydrateInstructionItems: metadata read failed', { code: metadataError.code });
    return null;
  }
  return {
    profiles: profilesResult.data,
    evidence: evidenceResult.data,
    dependencies: dependencyResult.data,
  };
}

/** The live fulfillments of the requirements and the predecessors outside the rows; null after a logged failed read. */
async function readInstructionItemFulfillments(
  admin: AdminClient,
  orgId: string,
  requirementIds: string[],
  missingPredecessorIds: string[],
) {
  const [fulfillmentResult, predecessorResult] = await Promise.all([
    readInBatches(requirementIds, (batch) =>
      admin
        .from('job_instruction_item_evidence_fulfillments')
        .select('id, evidence_requirement_id, document_id, artifact_revision_id, version')
        .eq('organization_id', orgId)
        .in('evidence_requirement_id', [...batch])
        .is('removed_at', null),
    ),
    readInBatches(missingPredecessorIds, (batch) =>
      admin
        .from('job_instruction_items')
        .select('id, content')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
  ]);
  const detailError = fulfillmentResult.error ?? predecessorResult.error;
  if (detailError) {
    logReadFailure('hydrateInstructionItems: fulfillment or predecessor read failed', {
      code: detailError.code,
    });
    return null;
  }
  return { fulfillments: fulfillmentResult.data, predecessors: predecessorResult.data };
}

/**
 * Adds provenance, evidence and predecessors to the rows. Returns null when any
 * of these reads fails, so no caller shows an item without its requirements.
 */
export async function hydrateInstructionItems(
  admin: AdminClient,
  orgId: string,
  rows: JobInstructionItemRow[],
): Promise<JobInstructionItemWithDetails[] | null> {
  const metadata = await readInstructionItemMetadata(admin, orgId, rows);
  if (!metadata) return null;
  const profileMap = new Map<string, ProfileReferenceRow>();
  for (const profile of metadata.profiles) profileMap.set(profile.id, profile);
  const requirementIds = metadata.evidence.map((requirement) => requirement.id);
  const contentById = new Map(rows.map((row) => [row.id, row.content]));
  // A single saved item is hydrated alone; its predecessors still need their labels.
  const missingPredecessorIds = metadata.dependencies
    .map((dependency) => dependency.predecessor_item_id)
    .filter((predecessorId) => !contentById.has(predecessorId));
  const details = await readInstructionItemFulfillments(admin, orgId, requirementIds, missingPredecessorIds);
  if (!details) return null;
  for (const predecessor of details.predecessors) contentById.set(predecessor.id, predecessor.content);
  const fulfillmentByRequirementId = new Map(
    details.fulfillments.map((fulfillment) => [
      fulfillment.evidence_requirement_id,
      {
        id: fulfillment.id,
        documentId: fulfillment.document_id,
        artifactRevisionId: fulfillment.artifact_revision_id,
        version: fulfillment.version,
      },
    ]),
  );
  return rows.map((row) => ({
    ...toJobInstructionItem(row),
    creator: toProfileReference(profileMap.get(row.created_by)),
    lastStatusChangedByProfile: toProfileReference(
      row.last_status_changed_by ? profileMap.get(row.last_status_changed_by) : null,
    ),
    evidenceRequirements: metadata.evidence
      .filter((item) => item.instruction_item_id === row.id)
      .map((item) => ({
        id: item.id,
        description: item.description,
        documentCategory: item.document_category,
        fulfillment: fulfillmentByRequirementId.get(item.id) ?? null,
      })),
    predecessors: metadata.dependencies
      .filter((item) => item.dependent_item_id === row.id)
      .map((item) => ({
        id: item.predecessor_item_id,
        content: contentById.get(item.predecessor_item_id) ?? 'Früherer Eintrag',
      })),
  }));
}
