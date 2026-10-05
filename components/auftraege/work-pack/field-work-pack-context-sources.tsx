import { CalendarClock, Siren, Wrench } from 'lucide-react';

import { FieldWorkPackSource } from '@/components/auftraege/work-pack/field-work-pack-source';
import { EQUIPMENT_STATE_LABELS, EQUIPMENT_SUBTYPE_LABELS } from '@/lib/installed-equipment/types';
import type { JobWithDetails } from '@/lib/jobs/types';
import { SERVICE_CASE_URGENCY_LABELS } from '@/lib/service-cases/types';
import type { FieldWorkPackData } from './field-work-pack-data';

type FieldWorkPackContextProps = {
  job: JobWithDetails;
  data: FieldWorkPackData;
};

/** Service and maintenance context released for this job. */
export function FieldWorkPackContextSources({ job, data }: FieldWorkPackContextProps) {
  const { serviceContextResult, maintenanceContextResult } = data;
  return (
    <>
      <FieldWorkPackSource
        sourceId={`${job.id}:service-context`}
        success={serviceContextResult.success}
        title="Servicekontext nicht verfügbar"
        description="Die für diesen Auftrag freigegebenen Servicehinweise konnten nicht geladen werden."
      >
        {serviceContextResult.success && serviceContextResult.contexts.length > 0 ? (
          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Siren className="size-4" />
              Serviceeinsatz
            </h2>
            <div className="mt-3 space-y-3">
              {serviceContextResult.contexts.map((context) => (
                <div key={context.caseNumber} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{context.summary}</p>
                    <span className="text-xs text-muted-foreground">
                      {context.caseNumber} · {SERVICE_CASE_URGENCY_LABELS[context.urgency]}
                    </span>
                  </div>
                  {context.accessInstructions && (
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Zugang:</span> {context.accessInstructions}
                    </p>
                  )}
                  {context.equipment.length > 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Betroffene Anlagen:{' '}
                      {context.equipment.map((item) => `${item.equipmentNumber} · ${item.name}`).join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </FieldWorkPackSource>
      <FieldWorkPackSource
        sourceId={`${job.id}:maintenance-context`}
        success={maintenanceContextResult.success}
        title="Wartungskontext nicht verfügbar"
        description="Die für diesen Auftrag freigegebenen Wartungshinweise konnten nicht geladen werden."
      >
        {maintenanceContextResult.success && maintenanceContextResult.contexts.length > 0 ? (
          <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <CalendarClock className="size-4" />
              Wartung
            </h2>
            <div className="mt-3 space-y-3">
              {maintenanceContextResult.contexts.map((context) => (
                <div key={`${context.planNumber}:${context.dueDate}`} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {context.templateName} · Version {context.templateVersionNumber}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {context.planNumber} · fällig{' '}
                      {new Intl.DateTimeFormat('de-DE').format(new Date(`${context.dueDate}T12:00:00Z`))}
                    </span>
                  </div>
                  {context.operationalInstructions && (
                    <p className="mt-2 text-sm">{context.operationalInstructions}</p>
                  )}
                  <p className="mt-2 text-sm text-muted-foreground">
                    Anlagen:{' '}
                    {context.equipment.map((item) => `${item.equipmentNumber} · ${item.name}`).join(', ')}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </FieldWorkPackSource>
    </>
  );
}

/** Installed equipment explicitly linked to this job. */
export function FieldWorkPackEquipmentSource({ job, data }: FieldWorkPackContextProps) {
  const { equipmentResult } = data;
  return (
    <FieldWorkPackSource
      sourceId={`${job.id}:equipment`}
      success={equipmentResult.success}
      title="Anlagendaten nicht verfügbar"
      description="Die ausdrücklich mit diesem Auftrag verknüpften Anlagen konnten nicht geladen werden."
    >
      {equipmentResult.success && equipmentResult.equipment.length > 0 ? (
        <section className="rounded-lg border bg-card p-4 shadow-xs sm:p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Wrench className="size-4" />
            Anlagen am Einsatzort
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nur Anlagen, die ausdrücklich mit diesem Auftrag verknüpft sind.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {equipmentResult.equipment.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <p className="font-medium">{item.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {item.equipmentNumber} · {EQUIPMENT_STATE_LABELS[item.state]}
                </p>
                <p className="mt-2 text-sm">
                  {[item.manufacturer, item.model].filter(Boolean).join(' · ') ||
                    'Hersteller und Modell nicht erfasst'}
                </p>
                {(item.subtype || item.locationDetail) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[item.subtype ? EQUIPMENT_SUBTYPE_LABELS[item.subtype] : null, item.locationDetail]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </FieldWorkPackSource>
  );
}
