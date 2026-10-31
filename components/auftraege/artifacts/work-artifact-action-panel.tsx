'use client';

import { Download, Trash2 } from 'lucide-react';

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
          <Button
            pending={isBusy('customer_acknowledged')}
            type="button"
            onClick={() => customerAction('customer_acknowledged')}
            disabled={anyBusy}
          >
            Bestätigung erfassen
          </Button>
          <Button
            pending={isBusy('customer_reserved')}
            type="button"
            variant="outline"
            onClick={() => customerAction('customer_reserved')}
            disabled={anyBusy}
          >
            Vorbehalt erfassen
          </Button>
          <Button
            pending={isBusy('customer_refused')}
            type="button"
            variant="outline"
            onClick={() => customerAction('customer_refused')}
            disabled={anyBusy}
          >
            Ablehnung erfassen
          </Button>
        </div>
        <SignaturePad disabled={anyBusy || Boolean(pendingSignatureDocumentId)} onChange={setSignatureFile} />
        {pendingSignatureDocumentId && (
          <p className="text-xs text-muted-foreground">
            Der Upload ist bereit. Du kannst das Speichern erneut versuchen.
          </p>
        )}
        <Button pending={isBusy('signature')} type="button" onClick={captureSignature} disabled={anyBusy}>
          Unterschrift speichern
        </Button>
      </div>
    </FormDisclosure>
  );
}

type WorkArtifactLinkDisclosureProps = Pick<WorkArtifactActionPanelProps, 'editor' | 'links'>;

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
  return (
    <>
      {documents.length > 0 && (
        <WorkArtifactDocumentLinkDisclosure editor={editor} links={links} documents={documents} />
      )}
      {timeEntryOptions.length > 0 && (
        <WorkArtifactTimeLinkDisclosure editor={editor} links={links} timeEntryOptions={timeEntryOptions} />
      )}
      {evidenceRequirements.length > 0 && (
        <FormDisclosure label="Nachweiserwartung erfüllen">
          <div className="divide-y rounded-md border">
            {evidenceRequirements.map((requirement) => (
              <WorkArtifactEvidenceRow
                key={requirement.id}
                requirement={requirement}
                currentRevision={currentRevision}
                editor={editor}
                links={links}
              />
            ))}
          </div>
        </FormDisclosure>
      )}
    </>
  );
}

function WorkArtifactDocumentLinkDisclosure({
  editor,
  links,
  documents,
}: WorkArtifactLinkDisclosureProps & Pick<WorkArtifactActionPanelProps, 'documents'>) {
  const { anyBusy, isBusy } = editor;
  const { documentId, selectDocument, documentError, documentRelation, setDocumentRelation, linkDocument } =
    links;
  return (
    <FormDisclosure label="Dokument verknüpfen">
      <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-[1fr_180px_auto]">
        <Field label="Dokument auswählen" hideLabel htmlFor="artifact-link-document" error={documentError}>
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
          onValueChange={(value) => {
            if (value === 'supporting_evidence' || value === 'closure_proof') setDocumentRelation(value);
          }}
        >
          <SelectTrigger aria-label="Dokumentbezug">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="supporting_evidence">Nachweis</SelectItem>
            <SelectItem value="closure_proof">Abschlussnachweis</SelectItem>
          </SelectContent>
        </Select>
        <Button
          pending={isBusy('document')}
          type="button"
          variant="outline"
          onClick={linkDocument}
          disabled={anyBusy}
        >
          Verknüpfen
        </Button>
      </div>
    </FormDisclosure>
  );
}

function WorkArtifactTimeLinkDisclosure({
  editor,
  links,
  timeEntryOptions,
}: WorkArtifactLinkDisclosureProps & Pick<WorkArtifactActionPanelProps, 'timeEntryOptions'>) {
  const { anyBusy, isBusy } = editor;
  const { timeSourceId, selectTimeSource, timeSourceError, linkTimeEntry } = links;
  return (
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
        <Button
          pending={isBusy('time')}
          type="button"
          variant="outline"
          onClick={linkTimeEntry}
          disabled={anyBusy}
        >
          Verknüpfen
        </Button>
      </div>
    </FormDisclosure>
  );
}

function WorkArtifactEvidenceRow({
  requirement,
  currentRevision,
  editor,
  links,
}: WorkArtifactLinkDisclosureProps &
  Pick<WorkArtifactActionPanelProps, 'currentRevision'> & { requirement: WorkArtifactEvidenceRequirement }) {
  const { isBusy } = editor;
  const { localFulfillments, removedFulfillmentIds, fulfill, removeFulfillment } = links;
  const fulfillment = removedFulfillmentIds.has(requirement.id)
    ? null
    : (localFulfillments.get(requirement.id) ?? requirement.fulfillment ?? null);
  // Row action: only this row's button is gated, the other rows stay usable.
  const rowBusy = isBusy(`evidence:${requirement.id}`);
  return (
    <div className="flex items-center justify-between gap-3 p-3">
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
  const { anyBusy, isBusy } = editor;
  const { actionReason, setActionReason, actionReasonError, act, setVoid } = review;
  const canVoid = Boolean(
    detail &&
      (isManager ||
        (detail.status === 'draft' && detail.created_by === currentUserId && detail.actions.length === 0)),
  );
  return (
    <div className="space-y-4 border-t pt-4">
      <WorkArtifactReviewButtons
        detail={detail}
        currentRevision={currentRevision}
        editor={editor}
        review={review}
        links={links}
        isManager={isManager}
        canApprove={canApprove}
        currentUserId={currentUserId}
      />
      <Field
        label="Begründung für Ablehnung, Korrektur, Vorbehalt oder Ungültigkeit"
        htmlFor="artifact-action-reason"
        error={actionReasonError}
      >
        <Textarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} />
      </Field>
      {detail.status === 'submitted' && canApprove && currentRevision.created_by !== currentUserId && (
        <Button
          pending={isBusy('internal_rejected')}
          type="button"
          variant="destructive"
          onClick={() => act('internal_rejected', actionReason)}
          disabled={anyBusy}
        >
          Ablehnen
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
            pending={isBusy('void')}
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={setVoid}
            disabled={anyBusy}
          >
            <Trash2 className="size-4" />
            Ungültig setzen
          </Button>
        </div>
      )}
    </div>
  );
}

/** The status transitions and the export of the current revision. */
function WorkArtifactReviewButtons({
  detail,
  currentRevision,
  editor,
  review,
  links,
  isManager,
  canApprove,
  currentUserId,
}: Pick<
  WorkArtifactActionPanelProps,
  'detail' | 'currentRevision' | 'editor' | 'review' | 'links' | 'isManager' | 'canApprove' | 'currentUserId'
>) {
  const { anyBusy, isBusy, setEditing } = editor;
  const { act } = review;
  const { exportArtifact } = links;
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => setEditing(true)} disabled={anyBusy}>
        Neue Version
      </Button>
      {detail.status === 'draft' && (
        <Button
          pending={isBusy('review_requested')}
          type="button"
          onClick={() => act('review_requested')}
          disabled={anyBusy}
        >
          Zur Prüfung einreichen
        </Button>
      )}
      {detail.status === 'submitted' && canApprove && currentRevision.created_by !== currentUserId && (
        <WorkArtifactApprovalButtons editor={editor} review={review} />
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
            pending={isBusy('review_withdrawn')}
            type="button"
            variant="outline"
            onClick={() => act('review_withdrawn')}
            disabled={anyBusy}
          >
            Prüfung zurückziehen
          </Button>
        )}
      {/* A project export is a project document write, which needs a manager. */}
      {(isManager || !detail.project_id) && (
        <Button
          pending={isBusy('export')}
          type="button"
          variant="outline"
          onClick={exportArtifact}
          disabled={anyBusy}
        >
          <Download className="size-4" />
          Export
        </Button>
      )}
    </div>
  );
}

function WorkArtifactApprovalButtons({
  editor,
  review,
}: Pick<WorkArtifactActionPanelProps, 'editor' | 'review'>) {
  const { anyBusy, isBusy } = editor;
  const { actionReason, act } = review;
  return (
    <>
      <Button
        pending={isBusy('internal_approved')}
        type="button"
        onClick={() => act('internal_approved')}
        disabled={anyBusy}
      >
        Intern freigeben
      </Button>
      <Button
        pending={isBusy('correction_requested')}
        type="button"
        variant="outline"
        onClick={() => act('correction_requested', actionReason)}
        disabled={anyBusy}
      >
        Korrektur anfordern
      </Button>
    </>
  );
}
