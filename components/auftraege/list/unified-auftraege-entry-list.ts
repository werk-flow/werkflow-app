import type { UnifiedListEntry } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import type {
  UnifiedAuftraegeJobMenuProps,
  UnifiedAuftraegeProjectMenuProps,
} from './unified-auftraege-row-cells';

/**
 * Per-row feedback the list owner derives from its optimistic overlay
 * (feedback canon): drafts the server has not confirmed render as a
 * `PendingRow` / dimmed card; rows saved through a dialog keep an inline
 * indicator until the authoritative read lands.
 */
export interface AuftraegeRowFeedback {
  pendingIds: ReadonlySet<string>;
  settlingIds: ReadonlySet<string>;
}

/** What the mobile cards and the desktop rows of the Aufträge list both render from. */
export type UnifiedAuftraegeEntryListProps = {
  entries: UnifiedListEntry[];
  pagedChildren: boolean;
  projectAssignmentMap: Record<string, string[]>;
  clientMap: Record<string, string>;
  isAdminOrManager: boolean;
  activeJobIds: Set<string>;
  rowFeedback: AuftraegeRowFeedback;
  memberLookup: Map<string, OrgMemberOption>;
  jobAssignmentMap: Record<string, string[]>;
  jobMenuProps: UnifiedAuftraegeJobMenuProps;
  projectMenuProps: Omit<UnifiedAuftraegeProjectMenuProps, 'clients'>;
};
