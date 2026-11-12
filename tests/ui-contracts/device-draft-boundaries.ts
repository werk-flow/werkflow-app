// Isolated stand-ins for what the report drafts on a device reach outside
// themselves: the active organization of the app's client state, the document
// upload path and the reader that answers whether the job is still the
// person's. The device store itself is the browser's real IndexedDB, and the
// sync handler is the spec's `page.route`.
import { contractDocument } from './document-upload-boundaries';

type UploadClient = typeof import('@/lib/documents/upload-client');

declare global {
  interface Window {
    uiContractDrafts: {
      /** The file names of the photo uploads, in order. */
      uploads: string[];
      /** Set by a spec: what the upload path answers. */
      uploadAnswer: 'saved' | 'interrupted' | 'refused';
      /** Set by a spec to an array: each upload waits until the spec calls its release. */
      heldUploads: Array<() => void> | null;
      /** Set by a spec: the server no longer lets the person see the job's Arbeitsnachweise. */
      jobAccessLost: boolean;
    };
  }
}

declare global {
  interface Window {
    /** Set by a spec's init script: no photo upload gets through, as on a page that loads without signal. */
    uiContractDraftsOffline?: boolean;
  }
}

window.uiContractDrafts = {
  uploads: [],
  uploadAnswer: window.uiContractDraftsOffline ? 'interrupted' : 'saved',
  heldUploads: null,
  jobAccessLost: false,
};

/** The active organization as the artifact section reads it from the app's client state. */
export function useOrganization(): { activeOrg: { orgId: string; role: 'employee' } } {
  return { activeOrg: { orgId: 'contract-organization', role: 'employee' } };
}

export const uploadDocumentDirect: UploadClient['uploadDocumentDirect'] = async ({ file }) => {
  const state = window.uiContractDrafts;
  state.uploads.push(file.name);
  const held = state.heldUploads;
  if (held) await new Promise<void>((release) => held.push(release));
  if (state.uploadAnswer !== 'saved')
    return { status: 'failed', reason: state.uploadAnswer, transferred: null };
  return {
    status: 'saved',
    saved: contractDocument(`contract-photo-${state.uploads.length}`, file.name),
  };
};

/** The job's Arbeitsnachweise as the access question after a refused upload reads them. */
export function readDraftJobAccessContract():
  | { success: true; artifacts: [] }
  | { success: false; error: 'not_authorized' } {
  return window.uiContractDrafts.jobAccessLost
    ? { success: false, error: 'not_authorized' }
    : { success: true, artifacts: [] };
}
