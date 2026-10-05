// Hosts of the immediate-feedback contracts: each renders one real product
// surface over the isolated server state in the matching boundary module. A
// route refresh re-reads that state as new props, as a server render would.
import { useEffect, useState } from 'react';
import { AnfragenContent } from '@/components/anfragen/anfragen-content';
import { JobMaterialsSection } from '@/components/inventar/job-materials-section';
import { EntryDetailsDialog } from '@/components/kalender/entry-details-dialog';
import { ClientRelationsSection } from '@/components/kunden/client-relations-section';
import { QualificationManagementSection } from '@/components/mitarbeiter/qualification-management-section';
import { TeamManagementSection } from '@/components/mitarbeiter/team-management-section';
import { ServiceCaseEvidenceLink } from '@/components/service/service-case-evidence-link';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { PendingApprovals } from '@/components/zeiterfassung/pending-approvals';
import { TimeCorrectionRequests } from '@/components/zeiterfassung/time-correction-requests';
import {
  parseRequestListQuery,
  type RequestListEntry,
  type RequestStatusFilter,
} from '@/lib/requests/list-page';
import type { ClientRequest } from '@/lib/requests/types';
import type { ServiceCaseDetail } from '@/lib/service-cases/types';
import type { WorkSession } from '@/lib/time-tracking/types';
import { clientRelationContractId } from './client-relation-boundaries';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';
import { useSearchParams } from './list-navigation-service-boundaries';
import { materialContractItem, materialContractLocation } from './material-boundaries';
import { readServiceEvidenceContract, serviceEvidenceOptions } from './service-evidence-boundaries';

const FEEDBACK_FIXTURES = [
  'time-approvals',
  'entry-details',
  'material-plan',
  'request-list',
  'client-relations',
  'team-qualifications',
  'service-evidence-link',
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

function contractRequest(id: string, summary: string, status: ClientRequest['status']): RequestListEntry {
  return {
    request: {
      id,
      organizationId: 'contract-organization',
      requestNumber: null,
      clientId: null,
      contactId: null,
      siteId: null,
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
  };
}

const REQUESTS = [
  contractRequest('contract-request-open', 'Heizung fällt aus', 'offen'),
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
  return <AnfragenContent entries={entries} total={entries.length} hasAnyRequest query={query} />;
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
  }
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
