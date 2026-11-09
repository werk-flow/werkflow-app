'use client';

import { useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { Input } from '@/components/ui/input';
import { SectionError } from '@/components/ui/section-error';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import { formatBerlinDateTime } from '@/lib/utils';
import {
  CUSTOMER_DECISION_LABELS,
  CUSTOMER_DECISION_TYPES,
  customerDecisionNeedsReason,
  isCustomerDecisionType,
  type RecordedCustomerDecision,
} from '@/lib/work-artifacts/customer-decision';
import { WORK_ARTIFACT_LEGAL_NOTICE } from '@/lib/work-artifacts/types';
import { SignaturePad } from './signature-pad';
import {
  CUSTOMER_DECISION_FIELD_IDS as FIELD_IDS,
  type WorkArtifactCustomerActions,
} from './use-work-artifact-customer-actions';
import type { WorkArtifactEditor } from './use-work-artifact-editor';

const SIGNATURE_LOAD_FAILED = 'Die Unterschrift konnte nicht geladen werden.';

/**
 * The customer's decision on the current customer-facing revision: the form
 * that records name, role, decision and signature in one save, or, once
 * recorded, what was recorded, so nobody records it twice.
 */
export function WorkArtifactCustomerDecision({
  editor,
  customer,
}: {
  editor: WorkArtifactEditor;
  customer: WorkArtifactCustomerActions;
}) {
  if (customer.recorded) return <RecordedCustomerDecisionView recorded={customer.recorded} />;
  return (
    <FormDisclosure label="Kundenentscheidung und Unterschrift">
      <CustomerDecisionForm editor={editor} customer={customer} />
    </FormDisclosure>
  );
}

function CustomerDecisionForm({
  editor,
  customer,
}: {
  editor: WorkArtifactEditor;
  customer: WorkArtifactCustomerActions;
}) {
  const { anyBusy, isBusy } = editor;
  const { errors, decision, pendingSignatureDocumentId } = customer;
  return (
    <form
      className="space-y-4 rounded-md border p-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!anyBusy) customer.saveDecision();
      }}
    >
      <p className="text-xs text-muted-foreground">{WORK_ARTIFACT_LEGAL_NOTICE}</p>
      <CustomerSignerFields customer={customer} />
      <Field label="Entscheidung" htmlFor={FIELD_IDS.decision} required error={errors.decision}>
        <Select
          value={decision ?? ''}
          onValueChange={(value) => {
            if (isCustomerDecisionType(value)) customer.setDecision(value);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Entscheidung wählen" />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMER_DECISION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {CUSTOMER_DECISION_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {decision && customerDecisionNeedsReason(decision) && (
        <Field
          label="Begründung der Kundin oder des Kunden"
          htmlFor={FIELD_IDS.reason}
          required
          error={errors.reason}
        >
          <Textarea
            value={customer.decisionReason}
            onChange={(event) => customer.setDecisionReason(event.target.value)}
          />
        </Field>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Unterschrift</p>
        <SignaturePad
          disabled={anyBusy || Boolean(pendingSignatureDocumentId)}
          onChange={customer.setSignatureFile}
        />
        {pendingSignatureDocumentId && (
          <p className="text-xs text-muted-foreground">
            Die Unterschrift ist hochgeladen. Du kannst das Speichern erneut versuchen.
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <Button pending={isBusy('customer-decision')} type="submit" disabled={anyBusy}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

function CustomerSignerFields({ customer }: { customer: WorkArtifactCustomerActions }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor={FIELD_IDS.name} required error={customer.errors.name}>
          <Input
            value={customer.customerName}
            onChange={(event) => customer.setCustomerName(event.target.value)}
          />
        </Field>
        <Field label="Rolle/Funktion" htmlFor={FIELD_IDS.role}>
          <Input
            value={customer.customerRole}
            onChange={(event) => customer.setCustomerRole(event.target.value)}
          />
        </Field>
      </div>
      <Field
        label="Bezug zum Kunden"
        htmlFor={FIELD_IDS.relationship}
        required
        error={customer.errors.relationship}
      >
        <Input
          value={customer.customerRelationship}
          onChange={(event) => customer.setCustomerRelationship(event.target.value)}
        />
      </Field>
    </>
  );
}

/** What the customer recorded on this revision: decision, signer, time, reason and signature. */
function RecordedCustomerDecisionView({ recorded }: { recorded: RecordedCustomerDecision }) {
  const { decision, signature } = recorded;
  const signer = decision ?? signature;
  const signerLine = [signer?.signer_name, signer?.signer_role, signer?.signer_relationship]
    .filter(Boolean)
    .join(' · ');
  return (
    <section aria-label="Kundenentscheidung" className="space-y-3 rounded-md border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kundenentscheidung</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {decision && (
          <RecordedFact label="Entscheidung">{CUSTOMER_DECISION_LABELS[decision.action_type]}</RecordedFact>
        )}
        <RecordedFact label="Erfasst am">
          {signer ? formatBerlinDateTime(signer.created_at) : '–'}
        </RecordedFact>
        {signerLine && <RecordedFact label="Kundin oder Kunde">{signerLine}</RecordedFact>}
        {decision?.reason && <RecordedFact label="Begründung">{decision.reason}</RecordedFact>}
      </dl>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Unterschrift</p>
        {signature?.signature_document_id ? (
          <RecordedSignatureImage
            documentId={signature.signature_document_id}
            signerName={signature.signer_name ?? 'der Kundin oder des Kunden'}
          />
        ) : (
          // A coworker reads that a signature exists, never its image or signer (redactWorkArtifactActionForField).
          <p className="text-sm">{signature ? 'Unterschrift erfasst' : 'Ohne Unterschrift erfasst'}</p>
        )}
      </div>
    </section>
  );
}

function RecordedFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

/**
 * The recorded signature image, read through a short-lived view URL, with its
 * loading state and a retry for a failed URL read or a failed image load.
 */
function RecordedSignatureImage({ documentId, signerName }: { documentId: string; signerName: string }) {
  const { activeOrgId } = useOrganization();
  const view = useClientRead({
    read: (signal) =>
      readInBackground('document-view-url', { organizationId: activeOrgId ?? '', documentId }, signal),
    deps: [activeOrgId, documentId],
    enabled: Boolean(activeOrgId),
    failureMessage: SIGNATURE_LOAD_FAILED,
  });
  // The URL whose image failed to load; a retry reads a fresh URL.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (view.failure) return <SectionError failure={view.failure} />;
  if (view.data && view.data.signedUrl === failedUrl) {
    return (
      <SectionError onRetry={view.reload} retryPending={view.loading}>
        {SIGNATURE_LOAD_FAILED}
      </SectionError>
    );
  }
  if (!view.data) {
    return (
      <div role="status" aria-busy="true">
        <span className="sr-only">Unterschrift wird geladen.</span>
        <Skeleton className="h-24 w-full max-w-xs" />
      </div>
    );
  }
  const signedUrl = view.data.signedUrl;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed private URL; next/image optimization cannot cache it
    <img
      src={signedUrl}
      alt={`Unterschrift von ${signerName}`}
      className="h-24 w-full max-w-xs rounded-md border object-contain"
      onError={() => setFailedUrl(signedUrl)}
    />
  );
}
