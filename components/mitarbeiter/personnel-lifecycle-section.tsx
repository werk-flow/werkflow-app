'use client';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PersonnelLifecycleView } from '@/lib/personnel/lifecycle-actions';

import {
  PersonnelLifecycleAccessFields,
  PersonnelLifecycleDialogFooter,
  PersonnelLifecycleEmploymentFields,
  PersonnelLifecycleUploadFields,
} from './personnel-lifecycle-dialog-parts';
import { PersonnelLifecycleDocumentsList } from './personnel-lifecycle-documents-list';
import {
  PersonnelLifecyclePlanDialog,
  PersonnelLifecycleRequirementDialog,
} from './personnel-lifecycle-onboarding-dialogs';
import { PersonnelLifecycleOnboardingList } from './personnel-lifecycle-onboarding-list';
import { PersonnelLifecycleHeader, PersonnelLifecycleStatusCards } from './personnel-lifecycle-overview';
import { usePersonnelLifecycleDocuments } from './use-personnel-lifecycle-documents';
import {
  usePersonnelLifecyclePlan,
  usePersonnelLifecycleRequirements,
} from './use-personnel-lifecycle-onboarding';
import { usePersonnelLifecycleTransitions } from './use-personnel-lifecycle-transitions';
import { usePersonnelLifecycleView } from './use-personnel-lifecycle-view';

export function PersonnelLifecycleSection({
  data: initialData,
  canManage,
  canAdministerAccess,
}: {
  data: PersonnelLifecycleView;
  canManage: boolean;
  canAdministerAccess: boolean;
}) {
  const lifecycle = usePersonnelLifecycleView(initialData);
  const transitions = usePersonnelLifecycleTransitions(lifecycle);
  const plan = usePersonnelLifecyclePlan(lifecycle);
  const requirements = usePersonnelLifecycleRequirements(lifecycle);
  const documents = usePersonnelLifecycleDocuments(lifecycle);
  const { data, isPending } = lifecycle;
  const { accessOpen, setAccessOpen, employmentOpen, setEmploymentOpen, submitAccess, submitEmployment } =
    transitions;
  const { uploadOpen, setUploadOpen, submitUpload } = documents;
  const hasUnresolvedWork =
    data.transitionInventory.activeJobs.length > 0 ||
    data.transitionInventory.strandedResponsibilities.length > 0;

  return (
    <section
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4 shadow-xs md:col-span-2 2xl:col-span-1"
      aria-labelledby="personnel-lifecycle-title"
      data-testid="personnel-lifecycle"
    >
      <PersonnelLifecycleHeader lifecycle={lifecycle} canAdministerAccess={canAdministerAccess} />

      <PersonnelLifecycleStatusCards
        lifecycle={lifecycle}
        transitions={transitions}
        canAdministerAccess={canAdministerAccess}
        hasUnresolvedWork={hasUnresolvedWork}
      />

      <PersonnelLifecycleOnboardingList
        lifecycle={lifecycle}
        plan={plan}
        requirements={requirements}
        canManage={canManage}
      />

      <PersonnelLifecycleDocumentsList lifecycle={lifecycle} documents={documents} canManage={canManage} />

      <Dialog open={accessOpen} onOpenChange={setAccessOpen} pending={isPending}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Organisationszugang steuern</DialogTitle>
            <DialogDescription>
              Die Änderung gilt nur für diese Organisation. Das globale Konto bleibt unberührt.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <PersonnelLifecycleAccessFields lifecycle={lifecycle} transitions={transitions} />
          </DialogBody>
          <PersonnelLifecycleDialogFooter
            lifecycle={lifecycle}
            submitLabel="Speichern"
            onCancel={() => setAccessOpen(false)}
            onSubmit={submitAccess}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={employmentOpen} onOpenChange={setEmploymentOpen} pending={isPending}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Beschäftigungsübergang erfassen</DialogTitle>
            <DialogDescription>
              Historische Zuordnungen bleiben erhalten. Vollständiges Offboarding folgt separat.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <PersonnelLifecycleEmploymentFields
              lifecycle={lifecycle}
              transitions={transitions}
              hasUnresolvedWork={hasUnresolvedWork}
            />
          </DialogBody>
          <PersonnelLifecycleDialogFooter
            lifecycle={lifecycle}
            submitLabel="Speichern"
            onCancel={() => setEmploymentOpen(false)}
            onSubmit={submitEmployment}
          />
        </DialogContent>
      </Dialog>

      <PersonnelLifecyclePlanDialog lifecycle={lifecycle} plan={plan} />

      <PersonnelLifecycleRequirementDialog lifecycle={lifecycle} requirements={requirements} />

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen} pending={isPending}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Geschützte Personalunterlage</DialogTitle>
            <DialogDescription>
              Die Datei wird direkt in den privaten Speicher geladen. Sie erscheint nicht in der normalen
              Dokumentenbibliothek.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 py-1">
            <PersonnelLifecycleUploadFields lifecycle={lifecycle} documents={documents} />
          </DialogBody>
          <PersonnelLifecycleDialogFooter
            lifecycle={lifecycle}
            submitLabel="Hochladen"
            onCancel={() => setUploadOpen(false)}
            onSubmit={submitUpload}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
