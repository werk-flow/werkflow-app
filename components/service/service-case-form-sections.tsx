'use client';

import type { ReactElement } from 'react';

import { ClientSelectWithCreate } from '@/components/auftraege/shared/client-select-with-create';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  SERVICE_CASE_CHARGE_CONTEXTS,
  SERVICE_CASE_CHARGE_CONTEXT_LABELS,
  SERVICE_CASE_STATUSES,
  SERVICE_CASE_STATUS_LABELS,
  SERVICE_CASE_URGENCY_LABELS,
  type ServiceCaseChargeContext,
  type ServiceCaseStatus,
} from '@/lib/service-cases/types';
import type { ServiceCaseFormState } from './service-case-form-state';
import type { ServiceCaseFormController } from './use-service-case-form';

// The customer select searches the server; no page preloads its choices.
const NO_PRELOADED_CLIENTS: never[] = [];

type ServiceCaseFieldsProps = {
  controller: ServiceCaseFormController;
  isUpdate: boolean;
};

/** Customer, site, contact and the customer's statement; only a new case records them. */
export function ServiceCaseIntakeFields({
  controller,
}: {
  controller: ServiceCaseFormController;
}): ReactElement {
  const { form, setForm, fieldErrors, clientOption, client } = controller;
  return (
    <>
      <Field label="Kunde" htmlFor="service-client" required error={fieldErrors.clientId}>
        <ClientSelectWithCreate
          clients={NO_PRELOADED_CLIENTS}
          value={form.clientId}
          onValueChange={(clientId) =>
            setForm((value) => ({
              ...value,
              clientId,
              siteId: '',
              contactId: '',
              equipmentIds: [],
            }))
          }
        />
      </Field>
      <Field label="Einsatzort" htmlFor="service-site" required error={fieldErrors.siteId}>
        <SearchableSelect
          value={form.siteId}
          onChange={(siteId) => setForm((value) => ({ ...value, siteId, equipmentIds: [] }))}
          options={(client?.sites ?? []).map((item) => ({
            value: item.id,
            label: item.name,
            description: item.address,
          }))}
          disabled={!form.clientId}
          loading={clientOption.loading}
          loadError={clientOption.error}
          onSearchChange={clientOption.error ? clientOption.retry : undefined}
          placeholder="Einsatzort wählen"
          searchPlaceholder="Einsatzort suchen…"
          emptyMessage="Kein Einsatzort gefunden"
        />
      </Field>
      <Field label="Ansprechpartner (optional)" htmlFor="service-contact" className="sm:col-span-2">
        <SearchableSelect
          value={form.contactId}
          onChange={(contactId) => setForm((value) => ({ ...value, contactId }))}
          options={(client?.contacts ?? []).map((item) => ({
            value: item.id,
            label: item.name,
          }))}
          disabled={!form.clientId}
          loading={clientOption.loading}
          placeholder="Kein Ansprechpartner"
          searchPlaceholder="Ansprechpartner suchen…"
          emptyMessage="Kein Ansprechpartner gefunden"
          allowNone
          noneLabel="Kein Ansprechpartner"
        />
      </Field>
      <Field
        label="Kundenaussage"
        htmlFor="service-statement"
        required
        error={fieldErrors.originalStatement}
        className="sm:col-span-2"
      >
        <Textarea
          value={form.originalStatement}
          onChange={(event) =>
            setForm((value) => ({
              ...value,
              originalStatement: event.target.value,
            }))
          }
          placeholder="Möglichst nah an der ursprünglichen Aussage erfassen"
        />
      </Field>
    </>
  );
}

/** Summary, urgency, status, charge context and the linked job. */
export function ServiceCaseTriageFields({ controller, isUpdate }: ServiceCaseFieldsProps): ReactElement {
  const { form, setForm, fieldErrors, availableJobs } = controller;
  return (
    <>
      <Field
        label="Kurzbeschreibung"
        htmlFor="service-summary"
        required
        error={fieldErrors.summary}
        className="sm:col-span-2"
      >
        <Input
          value={form.summary}
          onChange={(event) => setForm((value) => ({ ...value, summary: event.target.value }))}
        />
      </Field>
      <Field label="Dringlichkeit" htmlFor="service-urgency">
        <Select
          value={form.urgency}
          onValueChange={(urgency) =>
            setForm((value) => ({
              ...value,
              urgency: urgency as ServiceCaseFormState['urgency'],
            }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SERVICE_CASE_URGENCY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {isUpdate && (
        <Field label="Status" htmlFor="service-status">
          <Select
            value={form.status}
            onValueChange={(status) =>
              setForm((value) => ({
                ...value,
                status: status as ServiceCaseStatus,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SERVICE_CASE_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {SERVICE_CASE_STATUS_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label="Vorläufiger Kostenkontext" htmlFor="service-charge" className="sm:col-span-2">
        <Select
          value={form.chargeContext}
          onValueChange={(chargeContext) =>
            setForm((value) => ({
              ...value,
              chargeContext: chargeContext as ServiceCaseChargeContext,
            }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVICE_CASE_CHARGE_CONTEXTS.map((value) => (
              <SelectItem key={value} value={value}>
                {SERVICE_CASE_CHARGE_CONTEXT_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {isUpdate && (
        <Field label="Operativer Auftrag (optional)" htmlFor="service-job" className="sm:col-span-2">
          <SearchableSelect
            value={form.jobId}
            onChange={(jobId) => setForm((value) => ({ ...value, jobId }))}
            options={availableJobs.map((job) => ({
              value: job.id,
              label: `${job.jobNumber ? `${job.jobNumber} · ` : ''}${job.title}`,
            }))}
            placeholder="Noch kein Auftrag"
            searchPlaceholder="Auftrag suchen…"
            emptyMessage="Kein passender Auftrag gefunden"
            allowNone
            noneLabel="Noch kein Auftrag"
          />
        </Field>
      )}
    </>
  );
}

/** Access notes, the internal assessment and the affected equipment of the site. */
export function ServiceCaseSiteFields({
  controller,
}: {
  controller: ServiceCaseFormController;
}): ReactElement {
  const { form, setForm, site } = controller;
  return (
    <>
      <Field label="Zugang und Hinweise vor Ort" htmlFor="service-access" className="sm:col-span-2">
        <Textarea
          value={form.accessInstructions}
          onChange={(event) =>
            setForm((value) => ({
              ...value,
              accessInstructions: event.target.value,
            }))
          }
          placeholder="Zum Beispiel Zugang, Ansprechpartner oder Sicherheitsbesonderheiten"
        />
      </Field>
      <Field label="Interne Einschätzung" htmlFor="service-triage" className="sm:col-span-2">
        <Textarea
          value={form.triageNote}
          onChange={(event) => setForm((value) => ({ ...value, triageNote: event.target.value }))}
        />
      </Field>
      {site?.equipment.length ? (
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">Betroffene Anlagen</legend>
          <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
            {site.equipment.map((equipment) => (
              <label key={equipment.id} className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={form.equipmentIds.includes(equipment.id)}
                  onCheckedChange={(checked) =>
                    setForm((value) => ({
                      ...value,
                      equipmentIds: checked
                        ? [...value.equipmentIds, equipment.id]
                        : value.equipmentIds.filter((id) => id !== equipment.id),
                    }))
                  }
                />
                <span>
                  <span className="block font-medium">{equipment.name}</span>
                  <span className="text-xs text-muted-foreground">{equipment.equipmentNumber}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

/** The resolution note of a closing status and the reason of an edit. */
export function ServiceCaseClosingFields({ controller, isUpdate }: ServiceCaseFieldsProps): ReactElement {
  const { form, setForm, fieldErrors, terminal } = controller;
  return (
    <>
      {terminal && (
        <Field
          label="Abschlussbegründung"
          htmlFor="service-resolution"
          required
          error={fieldErrors.resolutionNote}
          className="sm:col-span-2"
        >
          <Textarea
            value={form.resolutionNote}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                resolutionNote: event.target.value,
              }))
            }
          />
        </Field>
      )}
      {isUpdate && (
        <Field
          label="Grund der Änderung"
          htmlFor="service-reason"
          required
          error={fieldErrors.reason}
          className="sm:col-span-2"
        >
          <Input
            value={form.reason}
            onChange={(event) => setForm((value) => ({ ...value, reason: event.target.value }))}
          />
        </Field>
      )}
    </>
  );
}
