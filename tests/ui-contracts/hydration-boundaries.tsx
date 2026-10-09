import { Suspense, startTransition, use, useEffect, useState, type ReactNode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { JobInstructionItemsCard } from '@/components/auftraege/instructions/job-instruction-items-card';
import { BannerProvider } from '@/components/ui/banner';
import { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import type { Job, JobInstructionItemWithDetails, ProjectWithDetails } from '@/lib/jobs/types';

export type HydrationFixtureName = 'instruction-hydration' | 'auftraege-hydration';

declare global {
  interface Window {
    /** Applies the page's one change after hydration: a server refresh or an own-action echo. */
    hydrationContract: { change: () => void };
    /** Root commits counted by the spec's DevTools hook. */
    hydrationCommits: { count: number };
  }
}

const serverItem: JobInstructionItemWithDetails = {
  id: 'item-1',
  organizationId: 'org-1',
  jobId: 'job-1',
  projectId: null,
  itemKind: 'checklist',
  requirementState: 'required',
  groupLabel: null,
  notes: null,
  templateApplicationId: null,
  sourceTemplateItemId: null,
  content: 'Absperrventil prüfen',
  sortOrder: 0,
  isCompleted: false,
  completionVersion: 0,
  createdBy: 'user-1',
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  lastStatusChangedBy: null,
  lastStatusChangedAt: null,
  creator: null,
  lastStatusChangedByProfile: null,
  evidenceRequirements: [],
  predecessors: [],
};

const pendingNavigation = new Promise<never>(() => undefined);

// Stands in for the flash banner's `router.replace`: a mount effect inside the
// hydrated boundary starts a route transition that stays pending, so the
// boundary's idle-priority mount updates wait behind it.
function PendingRouteTransition(): null {
  const [navigating, setNavigating] = useState(false);
  if (navigating) use(pendingNavigation);
  useEffect(() => {
    startTransition(() => setNavigating(true));
    document.title = 'Route wird geladen';
  }, []);
  return null;
}

function HydratedPage({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Suspense fallback={<p>Lädt</p>}>
          {children}
          <PendingRouteTransition />
        </Suspense>
      </main>
    </BannerProvider>
  );
}

function InstructionPage(): React.JSX.Element {
  const [items, setItems] = useState([serverItem]);
  useEffect(() => {
    // A route refresh delivers a new server list for the same rows.
    window.hydrationContract = {
      change: () =>
        setItems((current) =>
          current.map((item) => ({ ...item, content: `${item.content} (aktualisiert)` })),
        ),
    };
  }, []);
  return (
    <HydratedPage>
      <JobInstructionItemsCard
        jobId="job-1"
        initialItems={items}
        isAdminOrManager={false}
        currentUserActor={null}
      />
    </HydratedPage>
  );
}

const serverJobs: Job[] = [];
const serverProjects: ProjectWithDetails[] = [];
const serverAssignments: Record<string, string[]> = {};

// The Aufträge list's data owner and optimistic overlay, as `AuftraegeContent` composes them.
function AuftraegeList(): React.JSX.Element {
  const { projects, setRawProjects } = useLiveAuftraegeData({
    initialJobs: serverJobs,
    initialProjects: serverProjects,
    initialJobAssignmentMap: serverAssignments,
  });
  const overlay = useOptimisticList({ items: projects, getId: (project) => project.id });
  const [echoed, setEchoed] = useState(false);
  useEffect(() => {
    // An own action echoes into the rows through a functional update.
    window.hydrationContract = {
      change: () => {
        setEchoed(true);
        setRawProjects((current) => [...current]);
      },
    };
  }, [setRawProjects]);
  return (
    <output aria-label="Eigene Änderung">
      {echoed ? `übernommen, ${overlay.items.length} Projekte` : 'keine'}
    </output>
  );
}

function AuftraegePage(): React.JSX.Element {
  return (
    <HydratedPage>
      <AuftraegeList />
    </HydratedPage>
  );
}

/** Server-renders the page and hydrates it, so the boundary hydrates at offscreen priority as in the app. */
export function mountHydrationFixture(root: HTMLElement, name: HydrationFixtureName): void {
  const page = name === 'instruction-hydration' ? <InstructionPage /> : <AuftraegePage />;
  root.innerHTML = renderToString(page);
  hydrateRoot(root, page);
}
