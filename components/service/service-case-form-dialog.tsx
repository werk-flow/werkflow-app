'use client';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import type { ServiceCaseClientOption, ServiceCaseDetail } from '@/lib/service-cases/types';
import {
  ServiceCaseClosingFields,
  ServiceCaseIntakeFields,
  ServiceCaseSiteFields,
  ServiceCaseTriageFields,
} from './service-case-form-sections';
import { useServiceCaseForm, type ServiceCaseCreateSubmission } from './use-service-case-form';

export type { ServiceCaseCreateSubmission, ServiceCasePendingDraft } from './use-service-case-form';

export function ServiceCaseFormDialog({
  open,
  onOpenChange,
  client: preloadedClient,
  initial,
  onSubmitted,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The case's customer, already loaded by the detail page. */
  client?: ServiceCaseClientOption | null;
  initial?: ServiceCaseDetail;
  /**
   * Create from a list (feedback canon): the dialog closes at once and the
   * caller renders the pending row until `result` settles. Without it a
   * create navigates to the new record.
   */
  onSubmitted?: (submission: ServiceCaseCreateSubmission) => void;
  /** Edit settled by the caller (a live-view refresh) instead of a route refresh. */
  onSaved?: () => void;
}): ReactElement {
  const controller = useServiceCaseForm({
    onOpenChange,
    preloadedClient,
    initial,
    onSubmitted,
    onSaved,
  });
  const { isPending, submit } = controller;
  const isUpdate = Boolean(initial);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Servicefall bearbeiten' : 'Servicefall erfassen'}</DialogTitle>
          <DialogDescription>
            Erfasse die technische Nachfrage. Gewährleistung und Berechnung bleiben bis zur späteren Prüfung
            ausdrücklich vorläufig.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isPending) submit();
          }}
          noValidate
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <DialogBody>
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              {!initial && <ServiceCaseIntakeFields controller={controller} />}
              <ServiceCaseTriageFields controller={controller} isUpdate={isUpdate} />
              <ServiceCaseSiteFields controller={controller} />
              <ServiceCaseClosingFields controller={controller} isUpdate={isUpdate} />
            </div>
            <ErrorText>{controller.error}</ErrorText>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Abbrechen
            </Button>
            <Button pending={isPending} type="submit" disabled={isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
