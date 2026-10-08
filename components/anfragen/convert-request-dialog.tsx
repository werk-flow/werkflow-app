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
import type { Client } from '@/lib/jobs/types';
import { WorkTemplatePicker } from '@/components/arbeitsvorlagen/work-template-picker';
import { QualificationWarningDialog } from '@/components/auftraege/shared/qualification-warning-dialog';
import { ConvertRequestCustomerFields } from './convert-request-customer-fields';
import { ConvertRequestJobFields } from './convert-request-job-fields';
import { useConvertRequestForm, type ConversionTarget } from './use-convert-request-form';
import { Spinner } from '@/components/ui/spinner';

interface ConvertRequestDialogProps {
  request: ClientRequest;
  clients: Client[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the server confirmed; the page marks itself until refreshed props land. */
  onSaved?: () => void;
}

// Deliberate once-only conversion: everything the request captured is
// prefilled and stays editable; nothing is scheduled or assigned implicitly.
export function ConvertRequestDialog({
  request,
  clients,
  open,
  onOpenChange,
  onSaved,
}: ConvertRequestDialogProps) {
  const form = useConvertRequestForm({ request, open, onOpenChange, onSaved });
  const {
    target,
    setTarget,
    title,
    setTitle,
    number,
    setNumber,
    description,
    setDescription,
    templateVersionId,
    setTemplateVersionId,
    qualificationWarning,
    setQualificationWarning,
    isLoading,
    titleError,
    numberError,
    formError,
    submitConversion,
    handleSubmit,
  } = form;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} pending={isLoading}>
        <DialogContent workspace onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Anfrage umwandeln</DialogTitle>
            <DialogDescription>
              Die Angaben aus der Anfrage sind übernommen und bleiben mit der Anfrage verknüpft. Eine Anfrage
              kann nur einmal umgewandelt werden.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogBody className="grid gap-4 py-2">
              <Tabs value={target} onValueChange={(value) => setTarget(value as ConversionTarget)}>
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

              <ConvertRequestCustomerFields request={request} clients={clients} form={form} />

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
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <Spinner /> : <ArrowRightLeft className="size-4" />}
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
