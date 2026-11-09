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
  /**
   * How the next submissions answer after they saved the report: `lost` never
   * reaches the browser, `refused` answers `submit_failed`, as a database
   * answer lost on the server does.
   */
  submitAnswers: ('lost' | 'refused')[];
  /** File kinds whose next finalize registers the file, but whose answer never reaches the browser. */
  loseFinalizeAnswer: string[];
  /**
   * File kinds whose next finalize of an already registered file finds its
   * staging key gone, as a retry does while the first finalize still commits.
   */
  finalizeMissingOnce: string[];
  /** The refusal the next ticket of a file kind answers, such as `file_too_large`. */
  refuseTicketOnce: Record<string, string>;
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
    submitAnswers: [],
    loseFinalizeAnswer: [],
    finalizeMissingOnce: [],
    refuseTicketOnce: {},
  };
}

const savedReportIds = new Map<string, number>();

// `@/lib/problem-reports/actions`
export const submitProblemReport: ReportActions['submitProblemReport'] = async (input) => {
  // Saves each report id once, like `submit_problem_report`: a retry gets the same number.
  const state = window.uiContractProblemReport;
  state.submissions.push(input);
  if (!savedReportIds.has(input.reportId)) savedReportIds.set(input.reportId, 6 + savedReportIds.size + 1);
  const number = savedReportIds.get(input.reportId) ?? 0;
  const answer = state.submitAnswers.shift();
  if (answer === 'lost') throw new TypeError('Failed to fetch');
  if (answer === 'refused') return { success: false, error: 'submit_failed' };
  if (state.holdSubmission)
    await new Promise<void>((resolve) => {
      state.releaseSubmission = resolve;
    });
  return { success: true, reportId: input.reportId, number };
};

// `./file-actions` of the upload client
export const createProblemReportFileUploadTicket: FileActions['createProblemReportFileUploadTicket'] = async (
  input,
) => {
  const refusal = window.uiContractProblemReport.refuseTicketOnce[input.kind];
  if (refusal) {
    Reflect.deleteProperty(window.uiContractProblemReport.refuseTicketOnce, input.kind);
    return { success: false, error: refusal };
  }
  window.uiContractProblemReport.tickets.push(input.kind);
  const fileId = `33400000-0000-4000-8000-${String(window.uiContractProblemReport.tickets.length).padStart(12, '0')}`;
  return { success: true, ticket: { fileId, uploadUrl: `http://localhost/storage/${input.kind}/${fileId}` } };
};

const registeredFileIds = new Set<string>();

/** Registers each file id once, like `register_problem_report_file`. */
export const finalizeProblemReportFileUpload: FileActions['finalizeProblemReportFileUpload'] = async (
  input,
) => {
  const state = window.uiContractProblemReport;
  if (registeredFileIds.has(input.fileId)) {
    const missing = state.finalizeMissingOnce.indexOf(input.kind);
    if (missing < 0) return { success: false, error: 'already_finalized' };
    state.finalizeMissingOnce.splice(missing, 1);
    return { success: false, error: 'file_missing' };
  }
  if (input.kind === 'screenshot' && state.registered.includes('screenshot'))
    return { success: false, error: 'screenshot_exists' };
  registeredFileIds.add(input.fileId);
  state.registered.push(input.kind);
  const lost = state.loseFinalizeAnswer.indexOf(input.kind);
  if (lost >= 0) {
    state.loseFinalizeAnswer.splice(lost, 1);
    throw new TypeError('Failed to fetch');
  }
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
