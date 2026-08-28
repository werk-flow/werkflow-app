import type { Database, Json } from '@/lib/supabase/database.types';
import type { WorkExecutionState, WorkTargetType } from '@/lib/work-lifecycle/types';

export type WorkHandoverPackage = Database['public']['Tables']['work_handover_packages']['Row'];
export type WorkHandoverDraftItem = Database['public']['Tables']['work_handover_draft_items']['Row'];
export type WorkHandoverRelease = Database['public']['Tables']['work_handover_releases']['Row'];
export type WorkHandoverEvent = Database['public']['Tables']['work_handover_events']['Row'];
export type WorkHandoverCommercialReadiness =
  Database['public']['Enums']['work_handover_commercial_readiness_state'];
export type WorkHandoverPackageState =
  Database['public']['Enums']['work_handover_package_state'];

export type WorkHandoverSourceOption = {
  key: string;
  kind: Database['public']['Enums']['work_handover_source_kind'];
  label: string;
  description: string;
  workArtifactRevisionId: string | null;
  documentId: string | null;
  documentVersionNumber: number | null;
  documentStoragePath: string | null;
  childHandoverReleaseId: string | null;
};

export type WorkHandoverTargetSnapshot = {
  targetType: WorkTargetType;
  targetId: string;
  number: string | null;
  title: string;
  customerName: string | null;
  contactName: string | null;
  contactRole: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  siteName: string | null;
  siteAddress: string | null;
};

export type WorkHandoverWorkspace = {
  targetType: WorkTargetType;
  targetId: string;
  targetSnapshot: WorkHandoverTargetSnapshot;
  executionState: WorkExecutionState;
  executionVersion: number;
  packageId: string;
  packageVersion: number;
  packageState: WorkHandoverPackageState | 'missing';
  currentReleaseId: string | null;
  currentReleaseNumber: number | null;
  currentReleaseDocumentId: string | null;
  commercialReadiness: WorkHandoverCommercialReadiness | null;
  selectedSourceKeys: string[];
  staleSourceCount: number;
  availableSources: WorkHandoverSourceOption[];
  gateSnapshot: Json;
  gateFingerprint: string;
  releases: Array<Pick<
    WorkHandoverRelease,
    'id' | 'release_number' | 'commercial_readiness' | 'reviewed_at' |
    'package_document_id' | 'overridden_gates' | 'override_reason'
  >>;
  events: Array<Pick<
    WorkHandoverEvent,
    'id' | 'event_type' | 'reason' | 'created_at' | 'release_id'
  >>;
};

export type WorkHandoverFieldStatus = {
  state: WorkHandoverPackageState | 'missing';
  releaseNumber: number | null;
  reviewedAt: string | null;
  documentId: string | null;
};

export const WORK_HANDOVER_STATE_LABELS: Record<
  WorkHandoverPackageState | 'missing',
  string
> = {
  missing: 'Noch kein Übergabepaket',
  draft: 'Übergabe wird vorbereitet',
  released: 'An das Büro übergeben',
  reopened: 'Zur Korrektur geöffnet',
};

export const WORK_HANDOVER_READINESS_LABELS: Record<
  WorkHandoverCommercialReadiness,
  string
> = {
  not_ready: 'Noch nicht kaufmännisch prüfbar',
  ready_for_commercial_review: 'Bereit zur kaufmännischen Prüfung',
  ready_with_exceptions: 'Mit begründeten Ausnahmen prüfbar',
};
