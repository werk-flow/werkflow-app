'use client';

import { Download, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { FormDisclosure } from '@/components/ui/form-disclosure';
import { InlinePending } from '@/components/ui/inline-pending';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  WORK_ARTIFACT_LEGAL_NOTICE,
  type WorkArtifactDetail,
  type WorkArtifactTimeSourceOption,
} from '@/lib/work-artifacts/types';
import { SignaturePad } from './signature-pad';
import type { WorkArtifactCustomerActions } from './use-work-artifact-customer-actions';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactLinks } from './use-work-artifact-links';
import type { WorkArtifactReviewActions } from './use-work-artifact-review-actions';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';

type WorkArtifactActionPanelProps = {
  detail: WorkArtifactDetail;
  currentRevision: WorkArtifactDetail['revisions'][number];
  editor: WorkArtifactEditor;
  review: WorkArtifactReviewActions;
  customer: WorkArtifactCustomerActions;
  links: WorkArtifactLinks;
  isManager: boolean;
  canApprove: boolean;
  currentUserId: string;
  documents: OrganizationDocument[];
  timeEntryOptions: WorkArtifactTimeSourceOption[];
  evidenceRequirements: WorkArtifactEvidenceRequirement[];
};

function WorkArtifactCustomerDecision({
  editor,
  customer,
}: Pick<WorkArtifactActionPanelProps, 'editor' | 'customer'>) {
  const { anyBusy, isBusy } = editor;
  const {
    customerName,
    setCustomerName,
    customerNameError,
    customerRole,
    setCustomerRole,
    customerRelationship,
    setCustomerRelationship,
    setSignatureFile,
    pendingSignatureDocumentId,
    customerAction,
    captureSignature,
  } = customer;
  return (
    <FormDisclosure label="Kundenentscheidung und Unterschrift">
      <div className="space-y-4 rounded-md border p-4">
        <p className="text-xs text-muted-foreground">{WORK_ARTIFACT_LEGAL_NOTICE}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" htmlFor="artifact-customer-name" error={customerNameError}>
            <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </Field>
          <Field label="Rolle/Funktion" htmlFor="artifact-customer-role">
            <Input value={customerRole} onChange={(event) => setCustomerRole(event.target.value)} />
          </Field>
        </div>
        <Field label="Bezug zum Kunden" htmlFor="artifact-customer-relationship">
          <Input
            value={customerRelationship}
            onChange={(event) => setCustomerRelationship(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => customerAction('customer_acknowledged')} disabled={anyBusy}>
            {isBusy('customer_acknowledged') && <Loader2 className="size-4 animate-spin" />}Bestätigung
            erfassen
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => customerAction('customer_reserved')}
            disabled={anyBusy}
          >
            {isBusy('customer_reserved') && <Loader2 className="size-4 animate-spin" />}Vorbehalt erfassen
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => customerAction('customer_refused')}
            disabled={anyBusy}
          >
            {isBusy('customer_refused') && <Loader2 className="size-4 animate-spin" />}Ablehnung erfassen
          </Button>
        </div>
        <SignaturePad disabled={anyBusy || Boolean(pendingSignatureDocumentId)} onChange={setSignatureFile} />
        {pendingSignatureDocumentId && (
          <p className="text-xs text-muted-foreground">
            Der Upload ist bereit. Du kannst das Speichern erneut versuchen.
          </p>
        )}
        <Button type="button" onClick={captureSignature} disabled={anyBusy}>
          {isBusy('signature') && <Loader2 className="size-4 animate-spin" />}Unterschrift speichern
        </Button>
      </div>
    </FormDisclosure>
  );
}

function WorkArtifactLinkDisclosures({
  currentRevision,
  editor,
  links,
  documents,
  timeEntryOptions,
  evidenceRequirements,
}: Pick<
  WorkArtifactActionPanelProps,
  'currentRevision' | 'editor' | 'links' | 'documents' | 'timeEntryOptions' | 'evidenceRequirements'
>) {
  const { anyBusy, isBusy } = editor;
  const {
    documentId,
    selectDocument,
    documentError,
    documentRelation,
    setDocumentRelation,
    timeSourceId,
    selectTimeSource,
    timeSourceError,
    localFulfillments,
    removedFulfillmentIds,
    linkDocument,
    linkTimeEntry,
    fulfill,
    removeFulfillment,
  } = links;
  return (
    <>
      {documents.length > 0 && (
        <FormDisclosure label="Dokument verknüpfen">
          <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_180px_auto]">
            <Field
              label="Dokument auswählen"
              hideLabel
              htmlFor="artifact-link-document"
              error={documentError}
            >
              <SearchableSelect
                options={documents.map((document) => ({ value: document.id, label: document.displayName }))}
                value={documentId}
                onChange={selectDocument}
                placeholder="Dokument wählen"
                searchPlaceholder="Dokument suchen…"
                emptyMessage="Kein Dokument gefunden"
              />
            </Field>
            <Select
              value={documentRelation}
              onValueChange={(value) => setDocumentRelation(value as typeof documentRelation)}
            >
              <SelectTrigger aria-label="Dokumentbezug">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="supporting_evidence">Nachweis</SelectItem>
                <SelectItem value="closure_proof">Abschlussnachweis</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={linkDocument} disabled={anyBusy}>
              {isBusy('document') && <Loader2 className="size-4 animate-spin" />}Verknüpfen
            </Button>
          </div>
        </FormDisclosure>
      )}
      {timeEntryOptions.length > 0 && (
        <FormDisclosure label="Zeiteintrag verknüpfen">
          <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_auto]">
            <Field
              label="Zeiteintrag auswählen"
              hideLabel
              htmlFor="artifact-link-time-source"
              error={timeSourceError}
            >
              <SearchableSelect
                options={timeEntryOptions.map((entry) => ({ value: entry.id, label: entry.label }))}
                value={timeSourceId}
                onChange={selectTimeSource}
                placeholder="Zeiteintrag wählen"
                searchPlaceholder="Zeiteintrag suchen…"
                emptyMessage="Kein Zeiteintrag gefunden"
              />
            </Field>
            <Button type="button" variant="outline" onClick={linkTimeEntry} disabled={anyBusy}>
              {isBusy('time') && <Loader2 className="size-4 animate-spin" />}Verknüpfen
            </Button>
          </div>
        </FormDisclosure>
      )}
      {evidenceRequirements.length > 0 && (
        <FormDisclosure label="Nachweiserwartung erfüllen">
          <div className="divide-y rounded-md border">
            {evidenceRequirements.map((requirement) => {
              const fulfillment = removedFulfillmentIds.has(requirement.id)
                ? null
                : (localFulfillments.get(requirement.id) ?? requirement.fulfillment ?? null);
              // Row action: only this row's button is gated, the other rows stay usable.
              const rowBusy = isBusy(`evidence:${requirement.id}`);
              return (
                <div key={requirement.id} className="flex items-center justify-between gap-3 p-3">
                  <p className="text-sm">{requirement.description}</p>
                  <span className="flex shrink-0 items-center gap-2">
                    <InlinePending active={rowBusy} />
                    {fulfillment ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => removeFulfillment(requirement, fulfillment)}
                        disabled={rowBusy}
                      >
                        Erfüllung entfernen
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fulfill(requirement.id)}
                        disabled={rowBusy}
                      >{`Mit Version ${currentRevision.revision_number} erfüllen`}</Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </FormDisclosure>
      )}
    </>
  );
}

/** Everything the viewer can do with a saved, non-voided artifact revision. */
export function WorkArtifactActionPanel({
  detail,
  currentRevision,
  editor,
  review,
  customer,
  links,
  isManager,
  canApprove,
  currentUserId,
  documents,
  timeEntryOptions,
  evidenceRequirements,
}: WorkArtifactActionPanelProps) {
  const { anyBusy, isBusy, setEditing } = editor;
  const { actionReason, setActionReason, actionReasonError, act, setVoid } = review;
  const { exportArtifact } = links;
  const canVoid = Boolean(
    detail &&
      (isManager ||
        (detail.status === 'draft' && detail.created_by === currentUserId && detail.actions.length === 0)),
  );
  return (
    <div className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={anyBusy}>
          Neue Version
        </Button>
        {detail.status === 'draft' && (
          <Button type="button" onClick={() => act('review_requested')} disabled={anyBusy}>
            {isBusy('review_requested') && <Loader2 className="size-4 animate-spin" />}Zur Prüfung einreichen
          </Button>
        )}
        {detail.status === 'submitted' && canApprove && currentRevision.created_by !== currentUserId && (
          <>
            <Button type="button" onClick={() => act('internal_approved')} disabled={anyBusy}>
              {isBusy('internal_approved') && <Loader2 className="size-4 animate-spin" />}Intern freigeben
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => act('correction_requested', actionReason)}
              disabled={anyBusy}
            >
              {isBusy('correction_requested') && <Loader2 className="size-4 animate-spin" />}Korrektur
              anfordern
            </Button>
          </>
        )}
        {detail.status === 'submitted' &&
          (isManager ||
            detail.actions.some(
              (action) =>
                action.revision_id === currentRevision.id &&
                action.action_type === 'review_requested' &&
                action.created_by === currentUserId,
            )) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => act('review_withdrawn')}
              disabled={anyBusy}
            >
              {isBusy('review_withdrawn') && <Loader2 className="size-4 animate-spin" />}Prüfung zurückziehen
            </Button>
          )}
        {/* A project export is a project document write, which needs a manager. */}
        {(isManager || !detail.project_id) && (
          <Button type="button" variant="outline" onClick={exportArtifact} disabled={anyBusy}>
            {isBusy('export') ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Export
          </Button>
        )}
      </div>
      <Field
        label="Begründung für Ablehnung, Korrektur, Vorbehalt oder Ungültigkeit"
        htmlFor="artifact-action-reason"
        error={actionReasonError}
      >
        <Textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} />
      </Field>
      {detail.status === 'submitted' && canApprove && currentRevision.created_by !== currentUserId && (
        <Button
          type="button"
          variant="destructive"
          onClick={() => act('internal_rejected', actionReason)}
          disabled={anyBusy}
        >
          {isBusy('internal_rejected') && <Loader2 className="size-4 animate-spin" />}Ablehnen
        </Button>
      )}
      {currentRevision.visibility === 'customer_facing' && (
        <WorkArtifactCustomerDecision editor={editor} customer={customer} />
      )}
      <WorkArtifactLinkDisclosures
        currentRevision={currentRevision}
        editor={editor}
        links={links}
        documents={documents}
        timeEntryOptions={timeEntryOptions}
        evidenceRequirements={evidenceRequirements}
      />
      {canVoid && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={setVoid}
            disabled={anyBusy}
          >
            {isBusy('void') ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Ungültig setzen
          </Button>
        </div>
      )}
    </div>
  );
}
