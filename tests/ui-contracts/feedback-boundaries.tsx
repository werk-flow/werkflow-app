// Hosts of the immediate-feedback contracts: each renders one real product
// surface over the isolated server state in the matching boundary module. A
// route refresh re-reads that state as new props, as a server render would.
import { useEffect, useState } from 'react';
import { AnfragenContent } from '@/components/anfragen/anfragen-content';
import { RequestFactsCard } from '@/components/anfragen/request-facts-card';
import { WorkArtifactsSection } from '@/components/auftraege/artifacts/work-artifacts-section';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { EntryDetailsDialog } from '@/components/kalender/entry-details-dialog';
import { ClientRelationsSection } from '@/components/kunden/client-relations-section';
import { QualificationManagementSection } from '@/components/mitarbeiter/qualification-management-section';
import { TeamManagementSection } from '@/components/mitarbeiter/team-management-section';
import { ServiceCaseEvidenceLink } from '@/components/service/service-case-evidence-link';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { PendingApprovals } from '@/components/zeiterfassung/pending-approvals';
import { OpeningDateCorrections } from '@/components/zeiterfassung/time-account-opening-corrections';
import { MissingTimeAccountsCard } from '@/components/zeiterfassung/time-account-opening-form';
import { TimeCorrectionRequests } from '@/components/zeiterfassung/time-correction-requests';
import { CorrectionTimelineFields } from '@/components/zeiterfassung/time-correction-dialog-timeline';
import { useCorrectionTimeline } from '@/components/zeiterfassung/time-correction-dialog-timeline-state';
import {
  parseRequestListQuery,
  type RequestListEntry,
  type RequestStatusFilter,
} from '@/lib/requests/list-page';
import type { ClientRequest } from '@/lib/requests/types';
import type { ServiceCaseDetail } from '@/lib/service-cases/types';
import { NO_RECORDED_VISIT } from '@/lib/work-artifacts/types';
import type { WorkSession } from '@/lib/time-tracking/types';
import { clientRelationContractId } from './client-relation-boundaries';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';
import { useSearchParams } from './list-navigation-service-boundaries';
import { materialContractItem, materialContractLocation } from './material-boundaries';
import { readServiceEvidenceContract, serviceEvidenceOptions } from './service-evidence-boundaries';
import { approvedCustomerReport, CONTRACT_REPORT } from './work-artifact-boundaries';

const FEEDBACK_FIXTURES = [
  'time-approvals',
  'entry-details',
  'material-plan',
  'request-list',
  'client-relations',
  'team-qualifications',
  'service-evidence-link',
  'time-account-opening',
  'time-account-bulk-opening',
  'work-artifact-report',
  'correction-timeline',
  'work-artifact-customer-decision',
] as const;
export type FeedbackFixtureName = (typeof FEEDBACK_FIXTURES)[number];

export function isFeedbackFixture(name: string): name is FeedbackFixtureName {
  return FEEDBACK_FIXTURES.some((fixture) => fixture === name);
}

/** Route props over the boundary state; a router refresh reads them again. */
function useRouteProps<Props>(read: () => Props): Props {
  const [props, setProps] = useState(read);
  useEffect(() => {
    const reread = (): void => setProps(read());
    window.addEventListener(ROUTE_REFRESH_EVENT, reread);
    return () => window.removeEventListener(ROUTE_REFRESH_EVENT, reread);
  }, [read]);
  return props;
}

const readMaterialLines = () => structuredClone(window.uiContractMaterial.lines);
const readClientRelations = () => structuredClone(window.uiContractClientRelations);
const readQualifications = () => structuredClone(window.uiContractQualifications);
const readTimeAccounts = () => structuredClone(window.uiContractTimeAccounts);

function TimeAccountOpeningHost(): React.JSX.Element {
  const accounts = useRouteProps(readTimeAccounts);
  return <OpeningDateCorrections accounts={accounts} suggestedStartDate="2026-09-01" />;
}

const readMissingAccounts = () => structuredClone(window.uiContractMissingAccounts);

function TimeAccountBulkOpeningHost(): React.JSX.Element {
  const missingAccounts = useRouteProps(readMissingAccounts);
  return (
    <MissingTimeAccountsCard
      settings={{
        openAccountCount: 2 - missingAccounts.length,
        employeeCount: 2,
        missingAccounts,
        accounts: [],
        suggestedStartDate: '2026-09-01',
      }}
    />
  );
}

const orphanClockIn: WorkSession = {
  clockIn: {
    id: 'contract-orphan-in',
    userId: 'contract-worker',
    organizationId: 'contract-organization',
    entryType: 'clock_in',
    timestamp: '2026-10-01T06:00:00.000Z',
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: '2026-10-01T06:00:00.000Z',
    updatedAt: '2026-10-01T06:00:00.000Z',
  },
  clockOut: null,
  durationMinutes: null,
  jobId: null,
  isOrphan: true,
  pendingState: 'none',
};

/** The calendar opens the dialog from a block; an open modal hides the page heading from the fixture check. */
function EntryDetailsHost(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [refreshes, setRefreshes] = useState(0);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Eintrag öffnen</Button>
      <output aria-label="Kalender neu gelesen">{refreshes}</output>
      <EntryDetailsDialog
        open={open}
        onOpenChange={setOpen}
        session={orphanClockIn}
        currentUserRole="buero"
        currentUserId="contract-office"
        entryUserRole="employee"
        onRefresh={() => setRefreshes((count) => count + 1)}
      />
    </>
  );
}

const MATERIAL_ITEMS = [materialContractItem];
const MATERIAL_LOCATIONS = [materialContractLocation];

function MaterialPlanHost(): React.JSX.Element {
  const lines = useRouteProps(readMaterialLines);
  return (
    <JobMaterialsSection
      jobId="contract-job"
      initialLines={lines}
      inventoryItems={MATERIAL_ITEMS}
      locations={MATERIAL_LOCATIONS}
      isAdminOrManager
    />
  );
}

export function contractRequest(
  id: string,
  summary: string,
  status: ClientRequest['status'],
  callback: { dueAt: string; overdue: boolean } = { dueAt: '2026-10-01T10:00:00.000Z', overdue: false },
): RequestListEntry {
  return {
    request: {
      id,
      organizationId: 'contract-organization',
      requestNumber: null,
      clientId: null,
      contactId: null,
      siteId: null,
      equipmentId: null,
      callerName: 'Ines Imhof',
      callerPhone: null,
      callerEmail: null,
      callerAddress: null,
      summary,
      details: null,
      category: 'wartung',
      urgency: 'normal',
      source: 'telefon',
      status,
      assignedTo: null,
      receivedAt: '2026-10-01T08:00:00.000Z',
      callbackDueAt: callback.dueAt,
      closedReason: null,
      closedNote: null,
      closedBy: null,
      closedAt: null,
      convertedJobId: null,
      convertedProjectId: null,
      convertedBy: null,
      convertedAt: null,
      createdBy: null,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
    },
    clientName: null,
    assigneeName: null,
    convertedLabel: null,
    callbackOverdue: callback.overdue,
  };
}

// The first open request's promised callback had passed when the page was
// read; the second one's passes at noon, with no database event.
const REQUESTS = [
  contractRequest('contract-request-open', 'Heizung fällt aus', 'offen', {
    dueAt: '2026-10-01T10:00:00.000Z',
    overdue: true,
  }),
  contractRequest('contract-request-due', 'Wartung bestätigen', 'offen', {
    dueAt: '2026-10-01T12:00:00.000Z',
    overdue: false,
  }),
  contractRequest('contract-request-closed', 'Rückruf zur Abrechnung', 'geschlossen'),
];
const STATUSES_BY_FILTER: Record<RequestStatusFilter, readonly ClientRequest['status'][]> = {
  aktiv: ['offen', 'in_klaerung'],
  umgewandelt: ['umgewandelt'],
  geschlossen: ['geschlossen'],
  alle: ['offen', 'in_klaerung', 'umgewandelt', 'geschlossen'],
};

/** The server page for the committed URL: status scope and search apply before the list renders. */
function RequestListHost(): React.JSX.Element {
  const searchParams = useSearchParams();
  const query = parseRequestListQuery(Object.fromEntries(searchParams.entries()));
  const search = query.search.toLocaleLowerCase('de');
  const entries = REQUESTS.filter(
    (entry) =>
      STATUSES_BY_FILTER[query.status].includes(entry.request.status) &&
      entry.request.summary.toLocaleLowerCase('de').includes(search),
  );
  const due = REQUESTS[1];
  return (
    <>
      <AnfragenContent entries={entries} total={entries.length} hasAnyRequest query={query} />
      {due && (
        <section aria-label="Anfragedetails">
          <RequestFactsCard
            request={due.request}
            assigneeName="Erika Musterfrau"
            callbackOverdue={due.callbackOverdue}
            equipment={null}
          />
        </section>
      )}
    </>
  );
}

function ClientRelationsHost(): React.JSX.Element {
  const relations = useRouteProps(readClientRelations);
  return (
    <ClientRelationsSection
      clientId={clientRelationContractId}
      clientAddress={null}
      contacts={relations.contacts}
      sites={relations.sites}
      isAdminOrManager
      equipment={[]}
      equipmentLoadFailed={false}
    />
  );
}

function TeamQualificationHost(): React.JSX.Element {
  const workspace = useRouteProps(readQualifications);
  return (
    <>
      <section aria-label="Teams">
        <TeamManagementSection
          teams={workspace.teams}
          teamMemberships={workspace.teamMemberships}
          employees={workspace.employees}
        />
      </section>
      <section aria-label="Qualifikationen">
        <QualificationManagementSection
          capabilities={workspace.capabilities}
          employeeCapabilities={workspace.employeeCapabilities}
          employees={workspace.employees}
          apprenticeWarningEnabled={false}
          isAdmin
        />
      </section>
    </>
  );
}

/** The service-case detail around the evidence link: its live read is the boundary state. */
function ServiceEvidenceHost(): React.JSX.Element {
  const [evidence, setEvidence] = useState<ServiceCaseDetail['evidence']>([]);
  return (
    <ServiceCaseEvidenceLink
      serviceCase={{ id: 'contract-service-case', version: 1, jobId: 'contract-job', evidence }}
      options={serviceEvidenceOptions.filter(
        (option) => !evidence.some((item) => item.revisionId === option.revisionId),
      )}
      isStale={false}
      invalidate={() => undefined}
      refresh={async () => setEvidence(readServiceEvidenceContract())}
    />
  );
}

/** A forgotten day's timeline whose person can change, with a check of what a save would send. */
function CorrectionTimelineHost(): React.JSX.Element {
  const [employeeRecordId, setEmployeeRecordId] = useState('contract-person-a');
  const [checked, setChecked] = useState('');
  const timeline = useCorrectionTimeline({
    organizationId: 'contract-organization',
    employeeRecordId,
    dateIso: '2026-10-26',
    enabled: true,
  });
  return (
    <>
      <Button type="button" onClick={() => setEmployeeRecordId('contract-person-b')}>
        Andere Person
      </Button>
      <Button
        type="button"
        onClick={() => {
          const { resolved } = timeline.validate();
          setChecked(resolved.valid ? `${resolved.segments.length} Tätigkeiten` : 'unvollständig');
        }}
      >
        Prüfen
      </Button>
      <output aria-label="Prüfergebnis">{checked}</output>
      <CorrectionTimelineFields timeline={timeline} showErrors={false} />
    </>
  );
}

function FeedbackSurface({ name }: { name: FeedbackFixtureName }): React.JSX.Element {
  switch (name) {
    case 'time-approvals':
      return (
        <>
          <PendingApprovals
            organizationId="contract-organization"
            isAdmin
            currentUserRole="admin"
            currentUserId="contract-admin"
          />
          <TimeCorrectionRequests organizationId="contract-organization" mode="approvals" />
        </>
      );
    case 'entry-details':
      return <EntryDetailsHost />;
    case 'material-plan':
      return <MaterialPlanHost />;
    case 'request-list':
      return <RequestListHost />;
    case 'client-relations':
      return <ClientRelationsHost />;
    case 'team-qualifications':
      return <TeamQualificationHost />;
    case 'service-evidence-link':
      return <ServiceEvidenceHost />;
    case 'time-account-opening':
      return <TimeAccountOpeningHost />;
    case 'time-account-bulk-opening':
      return <TimeAccountBulkOpeningHost />;
    case 'correction-timeline':
      return <CorrectionTimelineHost />;
    case 'work-artifact-report':
      // A worker's job work pack with the visit window the page read from today's time records.
      return (
        <WorkArtifactsSection
          targetType="job"
          targetId="00000000-0000-4000-8000-000000000151"
          initialArtifacts={[]}
          isManager={false}
          canApprove={false}
          currentUserId="contract-worker"
          documents={[]}
          recordedVisit={window.uiContractRecordedVisit ?? NO_RECORDED_VISIT}
        />
      );
    case 'work-artifact-customer-decision':
      return <CustomerDecisionHost />;
  }
}

/**
 * A job's approved, customer-facing Arbeitsbericht as the assigned field worker
 * opens it, or as an Admin who reviews when the spec sets the viewer.
 */
function CustomerDecisionHost(): React.JSX.Element {
  const [report] = useState(() => {
    const detail = window.uiContractWorkArtifacts.detail ?? approvedCustomerReport();
    window.uiContractWorkArtifacts.detail = detail;
    return detail;
  });
  const revision = report.revisions[0];
  const manager = window.uiContractWorkArtifactViewer === 'admin';
  return (
    <WorkArtifactsSection
      targetType="job"
      targetId={CONTRACT_REPORT.jobId}
      initialArtifacts={revision ? [{ ...report, currentRevision: revision }] : []}
      isManager={manager}
      canApprove={manager}
      currentUserId={manager ? 'contract-admin' : 'contract-worker'}
      documents={[]}
      recordedVisit={NO_RECORDED_VISIT}
    />
  );
}

export function FeedbackContractFixture({ name }: { name: FeedbackFixtureName }): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <FeedbackSurface name={name} />
      </main>
    </BannerProvider>
  );
}
