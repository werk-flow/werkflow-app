'use client';

import { ArrowRightLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ErrorText } from '@/components/ui/error-text';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ClientRequest } from '@/lib/requests/types';
import type { ClientSelectItem } from '@/components/auftraege/shared/client-select-with-create';
import { WorkTemplatePicker } from '@/components/arbeitsvorlagen/work-template-picker';
import { QualificationWarningDialog } from '@/components/auftraege/shared/qualification-warning-dialog';
import { ConvertRequestCustomerFields } from './convert-request-customer-fields';
import { ConvertRequestJobFields } from './convert-request-job-fields';
import {
  CONVERSION_TARGETS,
  useConvertRequestForm,
  type ConvertRequestForm,
} from './use-convert-request-form';

interface ConvertRequestDialogProps {
  request: ClientRequest;
  /** The request's customer as the page shows it. */
  requestClient: ClientSelectItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the page marks itself until refreshed props land. */
  onSaved?: () => void;
}

/** The target kind, its template, and the title and number fields that change label with it. */
function ConvertRequestTargetFields({ form }: { form: ConvertRequestForm }) {
  const {
    target,
    setTarget,
    title,
    setTitle,
    number,
    setNumber,
    templateVersionId,
    setTemplateVersionId,
    isLoading,
    titleError,
    numberError,
  } = form;

  return (
    <>
      <Tabs
        panels={false}
        value={target}
        onValueChange={(value) => {
          const nextTarget = CONVERSION_TARGETS.find((candidate) => candidate === value);
          if (nextTarget) setTarget(nextTarget);
        }}
      >
        <TabsList className="h-9 w-full">
          <TabsTrigger value="job" className="flex-1">
            Auftrag
          </TabsTrigger>
          <TabsTrigger value="project" className="flex-1">
            Projekt
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <WorkTemplatePicker
        targetType={target}
        value={templateVersionId}
        onChange={setTemplateVersionId}
        disabled={isLoading}
      />

      <Field
        label={target === 'job' ? 'Titel' : 'Projektname'}
        htmlFor="convert-title"
        required
        error={titleError}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={isLoading} />
      </Field>

      <Field
        label={target === 'job' ? 'Auftragsnummer' : 'Projektnummer'}
        htmlFor="convert-number"
        required={target === 'job'}
        error={numberError}
      >
        <Input value={number} onChange={(e) => setNumber(e.target.value)} disabled={isLoading} />
      </Field>
    </>
  );
}

// Deliberate once-only conversion: everything the request captured is
// prefilled and stays editable; nothing is scheduled or assigned implicitly.
export function ConvertRequestDialog({
  request,
  requestClient,
  open,
  onOpenChange,
  onSaved,
}: ConvertRequestDialogProps) {
  const form = useConvertRequestForm({ request, open, onOpenChange, onSaved });
  const {
    target,
    description,
    setDescription,
    qualificationWarning,
    setQualificationWarning,
    isLoading,
    formError,
    submitConversion,
    handleSubmit,
  } = form;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
        <DialogContent workspace>
          <DialogHeader>
            <DialogTitle>Anfrage umwandeln</DialogTitle>
            <DialogDescription>
              Die Angaben aus der Anfrage sind übernommen und bleiben mit der Anfrage verknüpft. Eine Anfrage
              kann nur einmal umgewandelt werden.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="grid gap-4 py-2">
              <ConvertRequestTargetFields form={form} />

              <ConvertRequestCustomerFields request={request} requestClient={requestClient} form={form} />

              {target === 'job' && <ConvertRequestJobFields form={form} />}

              <Field label="Beschreibung" htmlFor="convert-description">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isLoading}
                />
              </Field>

              <ErrorText>{formError}</ErrorText>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Abbrechen
              </Button>
              <Button type="submit" pending={isLoading}>
                <ArrowRightLeft className="size-4" />
                {target === 'job' ? 'In Auftrag umwandeln' : 'In Projekt umwandeln'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <QualificationWarningDialog
        evaluation={qualificationWarning}
        isSubmitting={isLoading}
        onCancel={() => setQualificationWarning(null)}
        onConfirm={(approval) => submitConversion(approval)}
      />
    </>
  );
}
