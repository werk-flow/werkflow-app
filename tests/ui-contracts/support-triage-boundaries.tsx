import { useEffect, useState, type ReactElement } from 'react';

import { SupportReportDetail } from '@/components/support/support-report-detail';
import { BannerProvider } from '@/components/ui/banner';
import type { ActionResult } from '@/lib/action-result';
import type { TriageProblemReportInput } from '@/lib/problem-reports/schemas';
import type { ProblemReportOriginalResult, SupportReport } from '@/lib/problem-reports/types';
import { holdWrite } from './held-write-boundary';
import { ROUTE_REFRESH_EVENT } from './lifecycle-boundaries';

// Support's report page for its contract: the real triage form and original
// section run against stand-ins of `@/lib/problem-reports/support-actions`.
// A triage stays open until the spec answers it; a route refresh brings the
// report as the accepted writes and openings left it.

export const SUPPORT_CONTRACT_ORIGINAL = 'Bei Familie Beispiel speichert der Auftrag nicht.';

type SupportContractState = {
  /** The report the next route refresh brings. */
  report: SupportReport;
  /** The next action call fails as a lost connection does, before any answer. */
  failNextRequest: boolean;
};

declare global {
  interface Window {
    uiContractSupport: SupportContractState;
  }
}

window.uiContractSupport = {
  failNextRequest: false,
  report: {
    id: '33500000-0000-4000-8000-000000000020',
    number: 7,
    organizationName: 'Muster Haustechnik GmbH',
    createdAt: '2026-11-02T08:15:00.000Z',
    status: 'eingegangen',
    bucket: null,
    assigneeName: null,
    scrubState: 'bereinigt',
    scrubbedDescription: 'Bei [Kunde] speichert der Auftrag nicht.',
    filedForCaller: false,
    assigneeId: null,
    response: null,
    responseByAgent: false,
    originalsDeleted: false,
    scrubbedContext: {
      routeTemplate: '/auftraege/[jobNumber]',
      recentActions: [],
      clientErrors: [{ name: null, code: null, digest: '4182', routeTemplate: '/auftraege/[jobNumber]' }],
      appVersion: null,
      device: { platform: 'android', browser: 'chrome', viewport: { width: 412, height: 915 } },
      offline: false,
    },
    screenshotUrl: null,
    attachmentCount: 0,
    assignees: [{ userId: '33500000-0000-4000-8000-000000000003', name: 'Sina Sommer' }],
    history: [],
  },
};

function failIfAsked(): void {
  const state = window.uiContractSupport;
  if (!state.failNextRequest) return;
  state.failNextRequest = false;
  throw new Error('Simulated connection failure.');
}

export async function triageProblemReport(input: TriageProblemReportInput): Promise<ActionResult> {
  failIfAsked();
  const refusal = await holdWrite('triage', input);
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractSupport;
  const { status, response } = input.changes;
  state.report = {
    ...state.report,
    ...(status === undefined ? {} : { status }),
    ...(response === undefined ? {} : { response: response?.trim() || null }),
  };
  return { success: true };
}

export async function openProblemReportOriginal(): Promise<ProblemReportOriginalResult> {
  failIfAsked();
  const state = window.uiContractSupport;
  state.report = {
    ...state.report,
    history: [
      {
        id: `opening-${state.report.history.length + 1}`,
        createdAt: '2026-11-11T09:00:00.000Z',
        actorName: 'Sina Sommer',
        change: { kind: 'original_opened', attachment: false },
      },
      ...state.report.history,
    ],
  };
  return {
    success: true,
    original: {
      description: SUPPORT_CONTRACT_ORIGINAL,
      reporterName: 'Rita Melder',
      context: null,
      attachments: [],
    },
  };
}

export async function openProblemReportAttachment(): Promise<ActionResult<{ url: string }>> {
  failIfAsked();
  return { success: false, error: 'file_not_found' };
}

/** The report page's content, with the report a route refresh brings. */
export function SupportTriageContractFixture(): ReactElement {
  const [report, setReport] = useState(() => window.uiContractSupport.report);
  useEffect(() => {
    const adopt = (): void => setReport(window.uiContractSupport.report);
    window.addEventListener(ROUTE_REFRESH_EVENT, adopt);
    return () => window.removeEventListener(ROUTE_REFRESH_EVENT, adopt);
  }, []);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <SupportReportDetail report={report} />
      </main>
    </BannerProvider>
  );
}
