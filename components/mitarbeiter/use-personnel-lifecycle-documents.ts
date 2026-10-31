'use client';

import { useState } from 'react';

import { uploadPersonnelDocumentDirect } from '@/lib/documents/upload-client';
import { getPersonnelDocumentSignedUrl } from '@/lib/personnel/document-download-actions';
import { setPersonnelDocumentRelease } from '@/lib/personnel/lifecycle-actions';
import type { ProtectedPersonnelDocument } from '@/lib/personnel/lifecycle-rows';
import type { PersonnelDocumentAccessClass } from '@/lib/personnel/lifecycle';

import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import { ERROR_MESSAGES } from './personnel-lifecycle-errors';
import type { PersonnelLifecycleController } from './use-personnel-lifecycle-view';
import { logError } from '@/lib/logging';

export type PersonnelLifecycleDocuments = ReturnType<typeof usePersonnelLifecycleDocuments>;

async function togglePersonnelDocumentRelease(
  lifecycle: PersonnelLifecycleController,
  document: ProtectedPersonnelDocument,
): Promise<void> {
  const { data, mutationDisabled, rowBusy, showBanner, reconcileMutation, failureMessage } = lifecycle;
  if (mutationDisabled) return;
  await rowBusy
    .run(document.id, async () => {
      const result = await setPersonnelDocumentRelease({
        employeeRecordId: data.employeeRecordId,
        personnelDocumentId: document.id,
        documentVersionNumber: document.currentVersionNumber,
        release: !document.releasedToEmployee,
        reason: document.releasedToEmployee ? 'Freigabe zurückgenommen' : null,
        operationId: crypto.randomUUID(),
      });
      showBanner(
        result.success
          ? {
              variant: 'success',
              message: document.releasedToEmployee
                ? 'Freigabe wurde zurückgenommen.'
                : 'Dokument wurde für die betroffene Person freigegeben.',
            }
          : { variant: 'error', message: failureMessage(result.error) },
      );
      if (result.success) reconcileMutation();
    })
    .catch((submitError: unknown) => {
      logError('Unexpected error updating the document release:', submitError);
      showBanner({
        variant: 'error',
        message: ERROR_MESSAGES.mutation_failed,
      });
    });
}

async function openPersonnelDocument(
  lifecycle: PersonnelLifecycleController,
  document: ProtectedPersonnelDocument,
): Promise<void> {
  const { rowBusy, showBanner, failureMessage } = lifecycle;
  await rowBusy
    .run(document.id, async () => {
      const result = await getPersonnelDocumentSignedUrl(document.documentId);
      if (!result.success) {
        showBanner({ variant: 'error', message: failureMessage(result.error) });
        return;
      }
      window.location.assign(result.data.signedUrl);
    })
    .catch((downloadError: unknown) => {
      logError('Unexpected error opening the personnel document:', downloadError);
      showBanner({
        variant: 'error',
        message: 'Das Dokument konnte nicht geöffnet werden.',
      });
    });
}

/** Protected personnel documents: upload dialog, release toggle and download. */
export function usePersonnelLifecycleDocuments(lifecycle: PersonnelLifecycleController) {
  const {
    data,
    run,
    mutationDisabled,
    showBanner,
    setError,
    setFieldErrors,
    reconcileMutation,
    failureMessage,
  } = lifecycle;
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('');
  const [accessClass, setAccessClass] = useState<PersonnelDocumentAccessClass>('personnel_standard');

  async function submitUpload(): Promise<void> {
    if (mutationDisabled) return;
    setError(null);
    const nextErrors: Record<string, string> = {};
    if (!file) nextErrors['personnel-file'] = 'Bitte wähle eine Datei aus.';
    if (documentType.trim().length < 2) nextErrors['document-type'] = 'Bitte gib die Dokumentart an.';
    setFieldErrors(nextErrors);
    if (focusFirstInvalidField(nextErrors) || !file) return;
    try {
      await run(async () => {
        const result = await uploadPersonnelDocumentDirect({
          employeeRecordId: data.employeeRecordId,
          file,
          documentType,
          accessClass,
          evidenceState: 'valid',
          validUntil: null,
          operationId: crypto.randomUUID(),
        });
        if (!result.success) {
          setError(failureMessage(result.error));
          return;
        }
        setUploadOpen(false);
        setFile(null);
        setDocumentType('');
        showBanner({
          variant: 'success',
          message: 'Geschützte Personalunterlage wurde gespeichert.',
        });
        reconcileMutation();
      });
    } catch (submitError) {
      logError('Unexpected error uploading the personnel document:', submitError);
      setError(ERROR_MESSAGES.mutation_failed);
    }
  }

  return {
    uploadOpen,
    setUploadOpen,
    setFile,
    documentType,
    setDocumentType,
    accessClass,
    setAccessClass,
    submitUpload,
    toggleRelease: (document: ProtectedPersonnelDocument): Promise<void> =>
      togglePersonnelDocumentRelease(lifecycle, document),
    downloadDocument: (document: ProtectedPersonnelDocument): Promise<void> =>
      openPersonnelDocument(lifecycle, document),
  };
}
