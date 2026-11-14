import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure, loggedRead } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { getAuthorizedDocumentContext } from '@/lib/documents/access';
import { isFieldEquipmentDocument } from '@/lib/documents/equipment-access';
import { hydrateDocuments } from '@/lib/documents/hydration';
import type { OrganizationDocument } from '@/lib/documents/types';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { readJobAssignmentOfUser, readOrganizationJob } from '@/lib/jobs/job-access-reads';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { isExportableRevision } from '@/lib/work-artifacts/field-visibility';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// What the technician of a job reads about one Anlage of that job on the
// phone (werk-flow/werkflow-planning#468): its customer-safe history and the
// documents linked to it. A visit shows its date, outcome, and the defects and
// measurements of its customer-facing evidence; a replacement names the
// Vorgänger and the Nachfolger. No coverage, triage, commercial context,
// internal note, reason, person, price or cost leaves this module.

type Enums = Database['public']['Enums'];
type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

const FIELD_HISTORY_PAGE_SIZE = 10;
/** How far back a Vorgänger chain is followed; a real chain is a handful of devices. */
const PREDECESSOR_CHAIN_BOUND = 25;

export type FieldHistoryEquipment = {
  equipmentNumber: string;
  name: string;
  /** True for a Vorgänger of the job's Anlage. */
  isPredecessor: boolean;
};

export type FieldHistoryVisit = {
  kind: 'visit';
  key: string;
  /** The Berlin day the visit was completed. */
  date: string;
  outcome: Enums['maintenance_scope_outcome'];
  equipment: FieldHistoryEquipment;
  defects: Array<{
    description: string;
    location: string;
    severity: Enums['work_artifact_defect_severity'];
    state: Enums['work_artifact_defect_state'];
  }>;
  measurements: Array<{
    description: string;
    quantity: number;
    unit: Enums['work_artifact_measurement_unit'];
    location: string | null;
  }>;
};

type FieldHistoryReplacement = {
  kind: 'replacement';
  key: string;
  /** The Berlin day the replacement took effect. */
  date: string;
  predecessor: FieldHistoryEquipment;
  successor: FieldHistoryEquipment | null;
};

export type FieldHistoryEntry = FieldHistoryVisit | FieldHistoryReplacement;

export type FieldHistoryPage = {
  entries: FieldHistoryEntry[];
  /** Pass as `before` to read the next older page; null at the end. */
  nextCursor: string | null;
};

export const fieldHistoryInputSchema = z.object({
  jobId: uuidSchema,
  equipmentId: uuidSchema,
  before: z.string().max(200).nullable(),
});
export const fieldDocumentsInputSchema = fieldHistoryInputSchema.omit({ before: true });

type EquipmentRow = Pick<
  Database['public']['Tables']['installed_equipment']['Row'],
  'id' | 'equipment_number' | 'name' | 'predecessor_equipment_id'
>;
type FieldScope = { admin: AdminClient; organizationId: string; equipment: EquipmentRow };

const EQUIPMENT_COLUMNS = 'id, equipment_number, name, predecessor_equipment_id';
const LOAD_FAILED = { success: false, error: 'installed_equipment_load_failed' } as const;
const NOT_AUTHORIZED = { success: false, error: 'not_authorized' } as const;

/**
 * The caller reaches the Anlage only through the job: a manager any job of the
 * organization, an employee a job they are assigned to now, and the Anlage
 * must be linked to that job and not voided. A failed read is a load failure,
 * never a refusal.
 */
async function authorizeFieldEquipment(
  jobId: string,
  equipmentId: string,
): Promise<ActionResult<{ scope: FieldScope }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const organizationId = auth.context.orgId;
  const { data: job, error: jobError } = await readOrganizationJob(organizationId, jobId);
  if (jobError) return LOAD_FAILED;
  if (!job) return NOT_AUTHORIZED;
  if (!auth.context.isManagerOrAbove) {
    const assignment = await readJobAssignmentOfUser(organizationId, jobId, auth.context.userId);
    if (assignment.error) return LOAD_FAILED;
    if (!assignment.data) return NOT_AUTHORIZED;
  }
  const admin = createSupabaseAdminClient();
  const [workLink, equipment] = await Promise.all([
    loggedRead(
      'authorizeFieldEquipment: installed_equipment_work_links read failed',
      admin
        .from('installed_equipment_work_links')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('job_id', jobId)
        .eq('equipment_id', equipmentId)
        .limit(1)
        .maybeSingle(),
    ),
    loggedRead(
      'authorizeFieldEquipment: installed_equipment read failed',
      admin
        .from('installed_equipment')
        .select(EQUIPMENT_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('id', equipmentId)
        .is('voided_at', null)
        .maybeSingle(),
    ),
  ]);
  if (workLink.error || equipment.error) return LOAD_FAILED;
  if (!workLink.data || !equipment.data) return NOT_AUTHORIZED;
  return { success: true, scope: { admin, organizationId, equipment: equipment.data } };
}

/** The Anlage and its Vorgänger, nearest first; throws when a read fails. */
async function readPredecessorChain({
  admin,
  organizationId,
  equipment,
}: FieldScope): Promise<EquipmentRow[]> {
  const chain = [equipment];
  let previousId = equipment.predecessor_equipment_id;
  while (previousId && chain.length <= PREDECESSOR_CHAIN_BOUND) {
    const { data, error } = await loggedRead(
      'readPredecessorChain: installed_equipment read failed',
      admin
        .from('installed_equipment')
        .select(EQUIPMENT_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('id', previousId)
        .maybeSingle(),
    );
    if (error) throw new Error('installed_equipment_load_failed');
    if (!data || chain.some((row) => row.id === data.id)) break;
    chain.push(data);
    previousId = data.predecessor_equipment_id;
  }
  return chain;
}

function fail(label: string, error: { code?: string; message: string }): never {
  logReadFailure(label, { code: error.code ?? 'unknown', message: error.message });
  throw new Error('installed_equipment_load_failed');
}

/** Every row of an id-filtered table read, in batches and complete pages; throws on failure. */
async function readAllByIds<Row>(
  label: string,
  ids: readonly string[],
  page: (
    batch: readonly string[],
    from: number,
    to: number,
  ) => PromiseLike<{
    data: Row[] | null;
    error: { code?: string; message: string } | null;
  }>,
): Promise<Row[]> {
  if (ids.length === 0) return [];
  const { data, error } = await readInBatches(ids, (batch) =>
    readCompleteRows((from, to) => page(batch, from, to), LIST_ROW_CAP),
  );
  if (error) fail(label, error);
  return data;
}

type HistoryKey =
  | {
      kind: 'visit';
      key: string;
      date: string;
      dueWorkId: string;
      equipmentId: string;
      outcome: FieldHistoryVisit['outcome'];
    }
  | { kind: 'replacement'; key: string; date: string; predecessorId: string };

/** The nearest Anlage of the chain that each plan revision covers. */
function nearestChainEquipment(
  chain: EquipmentRow[],
  revisionLinks: Array<{ maintenance_plan_revision_id: string; equipment_id: string }>,
): Map<string, string> {
  const revisionEquipment = new Map<string, string>();
  for (const row of chain) {
    for (const link of revisionLinks) {
      if (link.equipment_id === row.id && !revisionEquipment.has(link.maintenance_plan_revision_id)) {
        revisionEquipment.set(link.maintenance_plan_revision_id, row.id);
      }
    }
  }
  return revisionEquipment;
}

/** Completed visits and uncorrected replacements as history keys. */
function historyKeysOf(
  dueWork: Array<{
    id: string;
    maintenance_plan_revision_id: string;
    completed_on: string | null;
    scope_outcome: FieldHistoryVisit['outcome'] | null;
  }>,
  events: Array<{
    id: string;
    equipment_id: string;
    event_type: string;
    effective_at: string;
    corrects_event_id: string | null;
  }>,
  revisionEquipment: Map<string, string>,
): HistoryKey[] {
  const corrected = new Set(
    events.flatMap((event) => (event.corrects_event_id ? [event.corrects_event_id] : [])),
  );
  return [
    ...dueWork.flatMap((due): HistoryKey[] => {
      const equipmentId = revisionEquipment.get(due.maintenance_plan_revision_id);
      return due.completed_on && due.scope_outcome && equipmentId
        ? [
            {
              kind: 'visit',
              key: `visit:${due.id}`,
              date: due.completed_on,
              dueWorkId: due.id,
              equipmentId,
              outcome: due.scope_outcome,
            },
          ]
        : [];
    }),
    ...events.flatMap((event): HistoryKey[] =>
      event.event_type === 'replaced' && !corrected.has(event.id)
        ? [
            {
              kind: 'replacement',
              key: `replacement:${event.id}`,
              date: formatBerlinLocalDate(event.effective_at),
              predecessorId: event.equipment_id,
            },
          ]
        : [],
    ),
  ];
}

/** Every visit and replacement of the chain as sort keys, newest first. */
async function readHistoryKeys(scope: FieldScope, chain: EquipmentRow[]): Promise<HistoryKey[]> {
  const { admin, organizationId } = scope;
  const chainIds = chain.map((row) => row.id);
  const [revisionLinks, events] = await Promise.all([
    readAllByIds(
      'readHistoryKeys: maintenance_plan_revision_equipment read failed',
      chainIds,
      (batch, from, to) =>
        admin
          .from('maintenance_plan_revision_equipment')
          .select('id, maintenance_plan_revision_id, equipment_id')
          .eq('organization_id', organizationId)
          .in('equipment_id', [...batch])
          .order('id')
          .range(from, to),
    ),
    readAllByIds('readHistoryKeys: installed_equipment_events read failed', chainIds, (batch, from, to) =>
      admin
        .from('installed_equipment_events')
        .select('id, equipment_id, event_type, effective_at, corrects_event_id')
        .eq('organization_id', organizationId)
        .in('equipment_id', [...batch])
        .in('event_type', ['replaced', 'terminal_action_corrected'])
        .order('id')
        .range(from, to),
    ),
  ]);
  const revisionEquipment = nearestChainEquipment(chain, revisionLinks);
  const dueWork = await readAllByIds(
    'readHistoryKeys: maintenance_due_work read failed',
    [...revisionEquipment.keys()],
    (batch, from, to) =>
      admin
        .from('maintenance_due_work')
        .select('id, maintenance_plan_revision_id, completed_on, scope_outcome')
        .eq('organization_id', organizationId)
        .eq('status', 'completed')
        .in('maintenance_plan_revision_id', [...batch])
        .order('id')
        .range(from, to),
  );
  const keys = historyKeysOf(dueWork, events, revisionEquipment);
  return keys.toSorted((left, right) => compareCursor(cursorOf(right), cursorOf(left)));
}

function cursorOf(entry: { date: string; key: string }): string {
  return `${entry.date}|${entry.key}`;
}

function compareCursor(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The evidence revisions a technician may read: customer-facing, of an artifact that is not voided. */
async function readShownRevisionIds(
  { admin, organizationId }: FieldScope,
  revisionIds: string[],
): Promise<string[]> {
  const revisions = await readAllByIds(
    'readVisitEvidence: work_artifact_revisions read failed',
    revisionIds,
    (batch, from, to) =>
      admin
        .from('work_artifact_revisions')
        .select('id, artifact_id, visibility')
        .eq('organization_id', organizationId)
        .in('id', [...batch])
        .order('id')
        .range(from, to),
  );
  const artifacts = await readAllByIds(
    'readVisitEvidence: work_artifacts read failed',
    [...new Set(revisions.map((revision) => revision.artifact_id))],
    (batch, from, to) =>
      admin
        .from('work_artifacts')
        .select('id')
        .eq('organization_id', organizationId)
        .is('voided_at', null)
        .in('id', [...batch])
        .order('id')
        .range(from, to),
  );
  const liveArtifacts = new Set(artifacts.map((artifact) => artifact.id));
  return revisions
    .filter((revision) => isExportableRevision(revision) && liveArtifacts.has(revision.artifact_id))
    .map((revision) => revision.id);
}

/** The customer-facing defects and measurements of each visit's evidence. */
async function readVisitEvidence(scope: FieldScope, dueWorkIds: string[]) {
  const { admin, organizationId } = scope;
  const evidenceLinks = await readAllByIds(
    'readVisitEvidence: maintenance_due_evidence_links read failed',
    dueWorkIds,
    (batch, from, to) =>
      admin
        .from('maintenance_due_evidence_links')
        .select('id, maintenance_due_work_id, work_artifact_revision_id')
        .eq('organization_id', organizationId)
        .in('maintenance_due_work_id', [...batch])
        .order('id')
        .range(from, to),
  );
  const shownRevisionIds = await readShownRevisionIds(
    scope,
    evidenceLinks.map((link) => link.work_artifact_revision_id),
  );
  const [defects, measurements] = await Promise.all([
    readAllByIds(
      'readVisitEvidence: work_artifact_defect_details read failed',
      shownRevisionIds,
      (batch, from, to) =>
        admin
          .from('work_artifact_defect_details')
          .select('revision_id, description, location, severity, state')
          .eq('organization_id', organizationId)
          .in('revision_id', [...batch])
          .order('revision_id')
          .range(from, to),
    ),
    readAllByIds(
      'readVisitEvidence: work_artifact_measurement_lines read failed',
      shownRevisionIds,
      (batch, from, to) =>
        admin
          .from('work_artifact_measurement_lines')
          .select('id, revision_id, line_number, description, quantity, unit, location')
          .eq('organization_id', organizationId)
          .in('revision_id', [...batch])
          .order('id')
          .range(from, to),
    ),
  ]);
  const revisionsOf = (dueWorkId: string) =>
    new Set(
      evidenceLinks
        .filter((link) => link.maintenance_due_work_id === dueWorkId)
        .map((link) => link.work_artifact_revision_id),
    );
  return (dueWorkId: string) => {
    const revisionIds = revisionsOf(dueWorkId);
    return {
      defects: defects
        .filter((defect) => revisionIds.has(defect.revision_id))
        .map(({ description, location, severity, state }) => ({ description, location, severity, state })),
      measurements: measurements
        .filter((line) => revisionIds.has(line.revision_id))
        .toSorted((left, right) => left.line_number - right.line_number)
        .map(({ description, quantity, unit, location }) => ({ description, quantity, unit, location })),
    };
  };
}

/** The successor of each replaced Anlage of the chain, voided corrections left out. */
async function readSuccessors(scope: FieldScope, predecessorIds: string[]): Promise<EquipmentRow[]> {
  const { admin, organizationId } = scope;
  return readAllByIds('readSuccessors: installed_equipment read failed', predecessorIds, (batch, from, to) =>
    admin
      .from('installed_equipment')
      .select(EQUIPMENT_COLUMNS)
      .eq('organization_id', organizationId)
      .is('voided_at', null)
      .in('predecessor_equipment_id', [...batch])
      .order('id')
      .range(from, to),
  );
}

/**
 * One page of the Anlage's history, newest first, older than `before`. The
 * history spans the Anlage and its Vorgänger; a page holds at most
 * {@link FIELD_HISTORY_PAGE_SIZE} entries.
 */
export async function getFieldEquipmentHistory(
  rawInput: z.input<typeof fieldHistoryInputSchema>,
): Promise<ActionResult<{ page: FieldHistoryPage }>> {
  const parsed = fieldHistoryInputSchema.safeParse(rawInput);
  if (!parsed.success) return NOT_AUTHORIZED;
  const { jobId, equipmentId, before } = parsed.data;
  const authorized = await authorizeFieldEquipment(jobId, equipmentId);
  if (!authorized.success) return authorized;
  const { scope } = authorized;
  try {
    const chain = await readPredecessorChain(scope);
    const keys = await readHistoryKeys(scope, chain);
    const older = before === null ? keys : keys.filter((key) => compareCursor(cursorOf(key), before) < 0);
    const pageKeys = older.slice(0, FIELD_HISTORY_PAGE_SIZE);
    const replacedIds = pageKeys.flatMap((key) => (key.kind === 'replacement' ? [key.predecessorId] : []));
    const [evidenceOf, successors] = await Promise.all([
      readVisitEvidence(
        scope,
        pageKeys.flatMap((key) => (key.kind === 'visit' ? [key.dueWorkId] : [])),
      ),
      readSuccessors(scope, replacedIds),
    ]);
    const known = new Map([...chain, ...successors].map((row) => [row.id, row]));
    const label = (id: string | undefined): FieldHistoryEquipment | null => {
      const row = id ? known.get(id) : undefined;
      return row
        ? {
            equipmentNumber: row.equipment_number,
            name: row.name,
            isPredecessor: row.id !== scope.equipment.id,
          }
        : null;
    };
    const entries = pageKeys.flatMap((key): FieldHistoryEntry[] => {
      if (key.kind === 'visit') {
        const equipment = label(key.equipmentId);
        return equipment
          ? [
              {
                kind: 'visit',
                key: key.key,
                date: key.date,
                outcome: key.outcome,
                equipment,
                ...evidenceOf(key.dueWorkId),
              },
            ]
          : [];
      }
      const predecessor = label(key.predecessorId);
      const successor = label(
        successors.find((row) => row.predecessor_equipment_id === key.predecessorId)?.id,
      );
      return predecessor
        ? [{ kind: 'replacement', key: key.key, date: key.date, predecessor, successor }]
        : [];
    });
    const last = pageKeys.at(-1);
    return {
      success: true,
      page: { entries, nextCursor: last && older.length > pageKeys.length ? cursorOf(last) : null },
    };
  } catch {
    return LOAD_FAILED;
  }
}

/**
 * The documents linked to the Anlage that its technician opens: ordinary
 * documents only, as `app_private.can_access_document` admits them.
 */
export async function getFieldEquipmentDocuments(
  rawInput: z.input<typeof fieldDocumentsInputSchema>,
): Promise<ActionResult<{ documents: OrganizationDocument[] }>> {
  const parsed = fieldDocumentsInputSchema.safeParse(rawInput);
  if (!parsed.success) return NOT_AUTHORIZED;
  const authorized = await authorizeFieldEquipment(parsed.data.jobId, parsed.data.equipmentId);
  if (!authorized.success) return authorized;
  const documentContext = await getAuthorizedDocumentContext();
  if (!documentContext.success) return documentContext;
  const { admin, organizationId, equipment } = authorized.scope;
  try {
    const equipmentLinks = await readAllByIds(
      'getFieldEquipmentDocuments: document_links read failed',
      [equipment.id],
      (batch, from, to) =>
        admin
          .from('document_links')
          .select('id, document_id')
          .eq('organization_id', organizationId)
          .in('equipment_id', [...batch])
          .order('id')
          .range(from, to),
    );
    const documentIds = [...new Set(equipmentLinks.map((link) => link.document_id))];
    const [documents, protectedDocuments, allLinks] = await Promise.all([
      readAllByIds('getFieldEquipmentDocuments: documents read failed', documentIds, (batch, from, to) =>
        admin
          .from('documents')
          .select('*')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .in('id', [...batch])
          .order('id')
          .range(from, to),
      ),
      readAllByIds(
        'getFieldEquipmentDocuments: personnel_documents read failed',
        documentIds,
        (batch, from, to) =>
          admin
            .from('personnel_documents')
            .select('id, document_id')
            .eq('organization_id', organizationId)
            .in('document_id', [...batch])
            .order('id')
            .range(from, to),
      ),
      readAllByIds('getFieldEquipmentDocuments: document_links read failed', documentIds, (batch, from, to) =>
        admin
          .from('document_links')
          .select('id, document_id, request_id, maintenance_coverage_id, employee_id')
          .eq('organization_id', organizationId)
          .in('document_id', [...batch])
          .order('id')
          .range(from, to),
      ),
    ]);
    const protectedIds = new Set(protectedDocuments.map((row) => row.document_id));
    const open = documents.filter(
      (document) =>
        !protectedIds.has(document.id) &&
        isFieldEquipmentDocument(
          document,
          allLinks.filter((link) => link.document_id === document.id),
        ),
    );
    const hydrated = await hydrateDocuments(documentContext.context, open);
    return {
      success: true,
      documents: hydrated.toSorted((left, right) => left.displayName.localeCompare(right.displayName, 'de')),
    };
  } catch {
    return LOAD_FAILED;
  }
}
