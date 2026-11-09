import type { ReactElement, ReactNode } from 'react';

import { ProblemReportButton } from '@/components/problem-reports/problem-report-button';
import { ProblemReportLauncher } from '@/components/problem-reports/problem-report-launcher';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { OpenDialogProvider } from '@/components/ui/open-dialog-context';
import type { UserOrg } from '@/lib/org/types';
import type { SubmitProblemReportInput } from '@/lib/problem-reports/schemas';

// The problem report's boundaries for the dialog contract: its Server
// Actions, the router, the organization and the screenshot redraw. The real
// launcher, dialog, recorder, context builder, redaction and upload client
// run; the spec answers the storage PUTs.

type ReportActions = typeof import('@/lib/problem-reports/actions');
type FileActions = typeof import('@/lib/problem-reports/file-actions');

export const PROBLEM_REPORT_CONTRACT_ORGANIZATION = '33400000-0000-4000-8000-000000000001';
const REPORT_ID = '33400000-0000-4000-8000-000000000020';
/** The width and height of the stub screenshot: white, so a burned box shows as black. */
export const STUB_SCREENSHOT_SIZE = { width: 400, height: 300 } as const;

type ProblemReportBoundaryState = {
  submissions: SubmitProblemReportInput[];
  /** The kind of each issued upload ticket. */
  tickets: string[];
  /** The kind of each registered file. */
  registered: string[];
  /** Resolves the held submission; null while none is held or holding is off. */
  releaseSubmission: (() => void) | null;
  holdSubmission: boolean;
};

declare global {
  interface Window {
    uiContractProblemReport: ProblemReportBoundaryState;
  }
}

export function initializeProblemReportBoundary(): void {
  window.uiContractProblemReport = {
    submissions: [],
    tickets: [],
    registered: [],
    releaseSubmission: null,
    holdSubmission: false,
  };
}

// `@/lib/problem-reports/actions`
export const submitProblemReport: ReportActions['submitProblemReport'] = async (input) => {
  const state = window.uiContractProblemReport;
  state.submissions.push(input);
  if (state.holdSubmission)
    await new Promise<void>((resolve) => {
      state.releaseSubmission = resolve;
    });
  return { success: true, reportId: REPORT_ID, number: 7 };
};

// `./file-actions` of the upload client
export const createProblemReportFileUploadTicket: FileActions['createProblemReportFileUploadTicket'] = async (
  input,
) => {
  window.uiContractProblemReport.tickets.push(input.kind);
  const fileId = `33400000-0000-4000-8000-00000000003${window.uiContractProblemReport.tickets.length}`;
  return { success: true, ticket: { fileId, uploadUrl: `http://localhost/storage/${input.kind}/${fileId}` } };
};

export const finalizeProblemReportFileUpload: FileActions['finalizeProblemReportFileUpload'] = async (
  input,
) => {
  window.uiContractProblemReport.registered.push(input.kind);
  return { success: true };
};

// `@/lib/problem-reports/screenshot/redraw-screenshot`: a white page, so the test reads burned boxes exactly.
export async function redrawScreenshot(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = STUB_SCREENSHOT_SIZE.width;
  canvas.height = STUB_SCREENSHOT_SIZE.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The contract browser cannot draw.');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No PNG.'))), 'image/png'),
  );
}

// `@/lib/problem-reports/screenshot/load-ui-string-catalog`: the app's own words of this fixture.
export function loadUiStringCatalog(): ReadonlySet<string> {
  return new Set(['Speichern', 'Problem melden']);
}

// `@/components/organization/organization-context`
export function useOrganization(): { activeOrg: UserOrg } {
  return {
    activeOrg: {
      orgId: PROBLEM_REPORT_CONTRACT_ORGANIZATION,
      name: 'Meldevertrag',
      uniqueCode: 'REPORT',
      role: 'employee',
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

// `next/navigation`
export function usePathname(): string {
  return '/auftraege/AUF-2026-001';
}

export function useParams(): Record<string, string> {
  return { jobNumber: 'AUF-2026-001' };
}

export function useRouter(): { push: (path: string) => void; refresh: () => void } {
  return { push: () => undefined, refresh: () => undefined };
}

// `next/link`
export default function Link({
  href,
  children,
  onClick,
}: {
  href: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.();
      }}
    >
      {children}
    </a>
  );
}

/** The app shell's report button beside two controls: one the app names, one a record names. */
export function ProblemReportContractFixture(): ReactElement {
  return (
    <BannerProvider>
      <OpenDialogProvider>
        <ProblemReportLauncher>
          <main>
            <h1>Komponentenverträge</h1>
            <Button>Speichern</Button>
            <Button>Musterbau Nord GmbH</Button>
            <ProblemReportButton placement="sidebar" />
          </main>
        </ProblemReportLauncher>
      </OpenDialogProvider>
    </BannerProvider>
  );
}
