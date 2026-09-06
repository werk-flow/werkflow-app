import type { PersonnelLifecycleView } from "@/lib/personnel/lifecycle-actions";

type PersonnelActions = typeof import("@/lib/personnel/lifecycle-actions");
type UploadClient = typeof import("@/lib/documents/upload-client");

declare global {
  interface Window {
    uiContractPersonnel: {
      snapshot: PersonnelLifecycleView;
      rejectUpload: boolean;
      rejectRead: boolean;
      holdRead: boolean;
      releaseRead: (() => void) | null;
      uploads: number;
      reads: number;
      rejectAcknowledgement: boolean;
      acknowledgements: number;
    };
  }
}

export function initializePersonnelBoundary(): PersonnelLifecycleView {
  const snapshot: PersonnelLifecycleView = {
    employeeRecordId: "contract-employee",
    userId: "contract-user",
    access: {
      id: null,
      state: "not_configured",
      storedState: null,
      effectiveAt: null,
      scheduledState: null,
      scheduledFor: null,
      version: 0,
    },
    employment: {
      id: null,
      state: null,
      effectiveOn: null,
      scheduledState: null,
      scheduledFor: null,
      version: 0,
    },
    plans: [],
    templates: [],
    documents: [],
    transitionInventory: { activeJobs: [], strandedResponsibilities: [] },
  };
  window.uiContractPersonnel = {
    snapshot,
    rejectUpload: false,
    rejectRead: false,
    holdRead: false,
    releaseRead: null,
    uploads: 0,
    reads: 0,
    rejectAcknowledgement: false,
    acknowledgements: 0,
  };
  // This independent initial route value never receives refreshed server props.
  return structuredClone(snapshot);
}

export async function getPersonnelLifecycle(
  employeeRecordId: Parameters<PersonnelActions["getPersonnelLifecycle"]>[0],
): ReturnType<PersonnelActions["getPersonnelLifecycle"]> {
  const state = window.uiContractPersonnel;
  if (employeeRecordId !== state.snapshot.employeeRecordId)
    throw new Error("Unexpected personnel read scope.");
  state.reads += 1;
  if (state.holdRead) {
    await new Promise<void>((resolveRead) => {
      state.releaseRead = () => {
        state.holdRead = false;
        state.releaseRead = null;
        resolveRead();
      };
    });
  }
  if (state.rejectRead) return { success: false, error: "load_failed" };
  return { success: true, data: structuredClone(state.snapshot) };
}

export async function uploadPersonnelDocumentDirect(
  input: Parameters<UploadClient["uploadPersonnelDocumentDirect"]>[0],
): ReturnType<UploadClient["uploadPersonnelDocumentDirect"]> {
  const state = window.uiContractPersonnel;
  if (state.rejectUpload) return { success: false, error: "not_authorized" };
  if (input.employeeRecordId !== state.snapshot.employeeRecordId)
    throw new Error("Unexpected personnel upload scope.");
  state.uploads += 1;
  const documentId = `contract-document-${state.uploads}`;
  state.snapshot = {
    ...state.snapshot,
    documents: [
      ...state.snapshot.documents,
      {
        id: documentId,
        documentId,
        displayName: input.file.name,
        documentType: input.documentType,
        accessClass: input.accessClass,
        evidenceState: input.evidenceState,
        validUntil: input.validUntil ?? null,
        currentVersionNumber: 1,
        releasedToEmployee: false,
        deletedAt: null,
        version: 1,
      },
    ],
  };
  // Persistence succeeds without Realtime delivery or any action RSC patch.
  return { success: true, data: { documentId } };
}

async function unexpectedPersonnelAction(): Promise<never> {
  throw new Error("Unexpected personnel operation in isolated UI contracts.");
}
export async function getOwnPersonnelActions(): ReturnType<PersonnelActions["getOwnPersonnelActions"]> {
  return { success: true, data: {
    organizationId: "contract-organization",
    employeeRecordId: window.uiContractPersonnel.snapshot.employeeRecordId,
    prestart: false,
    requirements: [],
    documents: [{
      id: "contract-released-document", documentId: "contract-file", displayName: "Willkommen.txt",
      documentType: "Willkommensunterlage", accessClass: "personnel_standard", evidenceState: "valid",
      validUntil: null, currentVersionNumber: 1, releasedToEmployee: true, deletedAt: null, version: 1,
    }],
  } };
}
export async function acknowledgePersonnelDocument(
  input: Parameters<PersonnelActions["acknowledgePersonnelDocument"]>[0],
): ReturnType<PersonnelActions["acknowledgePersonnelDocument"]> {
  if (!input || typeof input !== "object" || !("documentVersionNumber" in input) || input.documentVersionNumber !== 1) throw new Error("Unexpected receipt version");
  if (window.uiContractPersonnel.rejectAcknowledgement) return { success: false, error: "not_authorized" };
  window.uiContractPersonnel.acknowledgements += 1;
  return { success: true, data: { acknowledgementId: "contract-receipt" } };
}
export const acknowledgePersonnelRequirement = unexpectedPersonnelAction;
export const createPersonnelOnboardingPlan = unexpectedPersonnelAction;
export const exportPersonnelLifecycleManifest = unexpectedPersonnelAction;
export const getPersonnelDocumentSignedUrl = unexpectedPersonnelAction;
export const savePersonnelOnboardingRequirement = unexpectedPersonnelAction;
export const setPersonnelAccessTransition = unexpectedPersonnelAction;
export const setPersonnelDocumentRelease = unexpectedPersonnelAction;
export const setPersonnelEmploymentTransition = unexpectedPersonnelAction;
export const uploadDocumentDirect = unexpectedPersonnelAction;
