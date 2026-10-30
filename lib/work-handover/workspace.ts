import 'server-only';

import { z } from '@/lib/zod';
import type { AuthContext } from '@/lib/jobs/auth';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import { mapHandoverError } from './errors';
import { workHandoverPackageId } from './identity';
import { draftSourceKey, loadAvailableSources, type LoadedSourceOption } from './sources';
import { loadTargetSnapshot } from './target-snapshot';
import type { WorkHandoverDraftItem, WorkHandoverTarget, WorkHandoverWorkspace } from './types';

// The handover workspace a holder reviews. loadWorkspace in actions.ts reads
// the package's rows; this module reads its basis and assembles the result.

export type LoadedWorkspace = {
  organizationId: string;
  workspace: WorkHandoverWorkspace;
  draftItems: WorkHandoverDraftItem[];
  holder: EffectiveResponsibilityHolder;
  availableSources: LoadedSourceOption[];
};

type WorkspaceBasis = Awaited<ReturnType<typeof loadWorkspaceBasis>>;

const gateSnapshotSchema = z.object({ fingerprint: z.string(), snapshot: z.json() });

/** The target, its package, the gate snapshot and the selectable sources. */
export async function loadWorkspaceBasis(
  admin: AdminClient,
  context: AuthContext,
  target: WorkHandoverTarget,
): Promise<{
  target: Awaited<ReturnType<typeof loadTargetSnapshot>>;
  handoverPackage: Database['public']['Tables']['work_handover_packages']['Row'] | null;
  gate: z.output<typeof gateSnapshotSchema>;
  sources: LoadedSourceOption[];
}> {
  const targetData = await loadTargetSnapshot(admin, context.orgId, target);
  const targetColumn = target.targetType === 'job' ? 'job_id' : 'project_id';
  const [packageResult, gateResult, sources] = await Promise.all([
    admin
      .from('work_handover_packages')
      .select('*')
      .eq('organization_id', context.orgId)
      .eq(targetColumn, target.targetId)
      .maybeSingle(),
    admin.rpc('get_work_handover_gate_snapshot', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_target_type: target.targetType,
      p_target_id: target.targetId,
    }),
    loadAvailableSources(admin, context.orgId, target, targetData.projectJobIds),
  ]);
  const gate = gateSnapshotSchema.safeParse(gateResult.data);
  if (packageResult.error || gateResult.error || !gate.success) {
    throw new Error(mapHandoverError(packageResult.error ?? gateResult.error));
  }
  return { target: targetData, handoverPackage: packageResult.data, gate: gate.data, sources };
}

export function toLoadedWorkspace(input: {
  context: AuthContext;
  holder: EffectiveResponsibilityHolder;
  target: WorkHandoverTarget;
  basis: WorkspaceBasis;
  draftItems: WorkHandoverDraftItem[];
  releases: WorkHandoverWorkspace['releases'];
  events: WorkHandoverWorkspace['events'];
}): LoadedWorkspace {
  const { context, target, basis, draftItems } = input;
  const { handoverPackage, sources } = basis;
  const packageId =
    handoverPackage?.id ?? workHandoverPackageId(context.orgId, target.targetType, target.targetId);
  const sourceKeys = new Set(sources.map((source) => source.key));
  const draftKeys = draftItems.map(draftSourceKey);
  const currentRelease =
    input.releases.find((release) => release.id === handoverPackage?.current_release_id) ?? null;
  return {
    organizationId: context.orgId,
    holder: input.holder,
    draftItems,
    availableSources: sources,
    workspace: {
      targetType: target.targetType,
      targetId: target.targetId,
      targetSnapshot: basis.target.snapshot,
      executionState: basis.target.executionState,
      executionVersion: basis.target.executionVersion,
      packageId,
      packageVersion: handoverPackage?.version ?? 0,
      packageState: handoverPackage?.state ?? 'missing',
      currentReleaseId: handoverPackage?.current_release_id ?? null,
      currentReleaseNumber: currentRelease?.release_number ?? null,
      currentReleaseDocumentId: currentRelease?.package_document_id ?? null,
      commercialReadiness: currentRelease?.commercial_readiness ?? null,
      selectedSourceKeys: handoverPackage ? draftKeys.filter((key) => sourceKeys.has(key)) : [],
      staleSourceCount: draftKeys.filter((key) => !sourceKeys.has(key)).length,
      availableSources: sources.map((source) => ({
        key: source.key,
        kind: source.kind,
        label: source.label,
        description: source.description,
        workArtifactRevisionId: source.workArtifactRevisionId,
        documentId: source.documentId,
        documentVersionNumber: source.documentVersionNumber,
        documentStoragePath: source.documentStoragePath,
        childHandoverReleaseId: source.childHandoverReleaseId,
      })),
      gateSnapshot: basis.gate.snapshot,
      gateFingerprint: basis.gate.fingerprint,
      releases: input.releases,
      events: input.events,
    },
  };
}
