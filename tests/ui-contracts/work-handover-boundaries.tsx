import { useEffect, useState } from 'react';

import { WorkHandoverSection } from '@/components/auftraege/handover/work-handover-review';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';

declare global {
  interface Window {
    /** Set by a spec's init script: the job has no content to hand over yet. */
    uiContractHandoverWithoutSources?: boolean;
    /** Renders the review with the props a revalidating action's answer carries. */
    uiContractHandoverServerRender?: (patch: Partial<WorkHandoverWorkspace>) => void;
  }
}

const JOB_ID = '9a000000-0000-4000-8000-000000000163';

/** An execution-complete job whose handover was never opened: no package, no draft. */
function firstOpenWorkspace(withSources: boolean): WorkHandoverWorkspace {
  return {
    targetType: 'job',
    targetId: JOB_ID,
    targetSnapshot: {
      targetType: 'job',
      targetId: JOB_ID,
      number: 'AUF-2026-163',
      title: 'Thermostat tauschen',
      customerName: 'Familie Muster',
      contactName: null,
      contactRole: null,
      contactEmail: null,
      contactPhone: null,
      siteName: null,
      siteAddress: null,
    },
    executionState: 'execution_complete',
    executionVersion: 3,
    packageId: '9a000000-0000-4000-8000-000000000164',
    packageVersion: 0,
    packageState: 'missing',
    currentReleaseId: null,
    currentReleaseNumber: null,
    currentReleaseDocumentId: null,
    commercialReadiness: null,
    selectedSourceKeys: [],
    staleSourceCount: 0,
    availableSources: withSources
      ? [
          {
            key: 'artifact:9a000000-0000-4000-8000-000000000165',
            kind: 'work_artifact_revision',
            label: 'Arbeitsbericht Thermostat',
            description: 'Freigegebener Arbeitsnachweis · Version 1',
            workArtifactRevisionId: '9a000000-0000-4000-8000-000000000165',
            documentId: null,
            documentVersionNumber: null,
            documentStoragePath: null,
            childHandoverReleaseId: null,
          },
        ]
      : [],
    gateSnapshot: {},
    gateFingerprint: 'contract-gates',
    releases: [],
    events: [],
  };
}

/** The handover review of a job opened for the first time. */
export function WorkHandoverContractFixture(): React.JSX.Element {
  const [workspace, setWorkspace] = useState(() =>
    firstOpenWorkspace(!window.uiContractHandoverWithoutSources),
  );
  useEffect(() => {
    window.uiContractHandoverServerRender = (patch) => setWorkspace((current) => ({ ...current, ...patch }));
  }, []);
  return (
    <main>
      <h1>Komponentenverträge</h1>
      <WorkHandoverSection initialWorkspace={workspace} workHref="/auftraege/AUF-2026-163" />
    </main>
  );
}
