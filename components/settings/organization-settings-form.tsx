'use client';

import { describeFailure } from '@/lib/action-messages';
import type { ActionFailure } from '@/lib/action-result';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormReturn } from 'react-hook-form';

import { DeleteOrgDialog } from '@/components/org/delete-org-dialog';
import { useSaveChangesSubmit } from '@/components/settings/use-save-changes-submit';
import { saveFailureBanner } from '@/lib/settings/save-answers';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Form, FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { InlinePending } from '@/components/ui/inline-pending';
import { useServerAction } from '@/hooks/use-server-action';
import {
  updateOrganizationSettings,
  type UpdateOrganizationSettingsResult,
} from '@/lib/org/settings-actions';
import {
  ORGANIZATION_CODE_LENGTH,
  organizationSettingsSchema,
  type OrganizationSettingsValues,
} from '@/lib/org/schemas';
import type { OrganizationDeletionScope } from '@/lib/org/types';
import { getRoleLabel } from '@/lib/roles';

const ERROR_MESSAGES = {
  org_not_found: 'Die Organisation konnte nicht gefunden werden.',
  not_authorized: 'Nur Admins können diese Organisationsdaten bearbeiten.',
  name_required: 'Bitte gib einen Namen ein.',
  name_too_short: 'Der Name muss mindestens 2 Zeichen lang sein.',
  name_too_long: 'Der Name darf maximal 100 Zeichen lang sein.',
  name_taken: 'Du hast bereits eine Organisation mit diesem Namen.',
  code_required: 'Bitte gib einen Organisationscode ein.',
  code_invalid:
    'Der Organisationscode muss genau 6 Zeichen lang sein und darf nur Großbuchstaben sowie Zahlen enthalten.',
  code_taken: 'Dieser Organisationscode ist bereits vergeben.',
  update_failed: 'Die Organisation konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

type OrganizationSettingsFormProps = {
  initialOrganization: {
    name: string;
    uniqueCode: string;
    createdAtLabel: string;
    role: 'admin' | 'buero' | 'employee';
  };
  /** What a deletion removes, read for Admins only; null for other roles. */
  deletionScope: OrganizationDeletionScope | 'load_failed' | null;
};

type OrganizationSaveError = Extract<UpdateOrganizationSettingsResult, ActionFailure>['error'];

/** Shows a refused save on the field it concerns, or as a banner when no field owns it. */
function showSaveFailure(
  form: UseFormReturn<OrganizationSettingsValues>,
  error: OrganizationSaveError,
  showBanner: ReturnType<typeof useBanner>['showBanner'],
): void {
  if (error === 'name_taken') {
    form.setError('name', {
      message: ERROR_MESSAGES.name_taken,
    });
    return;
  }

  if (error === 'code_taken' || error === 'code_invalid') {
    form.setError('uniqueCode', {
      message: describeFailure(error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed),
    });
    return;
  }

  if (error === 'name_required' || error === 'name_too_short' || error === 'name_too_long') {
    form.setError('name', {
      message: describeFailure(error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed),
    });
    return;
  }

  if (error === 'code_required') {
    form.setError('uniqueCode', {
      message: ERROR_MESSAGES.code_required,
    });
    return;
  }

  showBanner(saveFailureBanner(error, ERROR_MESSAGES, ERROR_MESSAGES.update_failed));
}

function OrganizationDetailsCard({
  roleLabel,
  createdAtLabel,
}: {
  roleLabel: string;
  createdAtLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisationsdetails</CardTitle>
        <CardDescription>
          Die wichtigsten Stammdaten deiner aktiven Organisation auf einen Blick.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Deine Rolle</p>
          <p className="text-sm text-muted-foreground">{roleLabel}</p>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Erstellt am</p>
          <p className="text-sm text-muted-foreground">{createdAtLabel}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function OrganizationFields({
  form,
  disabled,
}: {
  form: UseFormReturn<OrganizationSettingsValues>;
  disabled: boolean;
}) {
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field, fieldState }) => (
          <Field
            label="Name der Organisation"
            required
            description="Pro Admin darf jeder Organisationsname nur einmal vergeben sein."
            error={fieldState.error?.message}
          >
            <Input
              {...field}
              autoComplete="organization"
              disabled={disabled}
              maxLength={100}
              placeholder="z.B. WerkFlow Nord"
            />
          </Field>
        )}
      />

      <FormField
        control={form.control}
        name="uniqueCode"
        render={({ field, fieldState }) => (
          <Field
            label="Organisationscode"
            required
            description="Dieser Code muss organisationsweit eindeutig sein, damit neue Nutzer gezielt beitreten können."
            error={fieldState.error?.message}
          >
            <Input
              {...field}
              autoCapitalize="characters"
              autoComplete="off"
              className="font-mono uppercase tracking-[0.3em]"
              disabled={disabled}
              maxLength={ORGANIZATION_CODE_LENGTH}
              onChange={(event) => field.onChange(event.target.value.toUpperCase().replace(/\s+/g, ''))}
              placeholder="ABC123"
              spellCheck={false}
            />
          </Field>
        )}
      />
    </>
  );
}

function OrganizationSaveFooter({ canEdit, isSaving }: { canEdit: boolean; isSaving: boolean }) {
  return (
    <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        {canEdit
          ? 'Änderungen wirken sich direkt auf alle Mitglieder dieser Organisation aus.'
          : 'Du kannst diese Daten einsehen, aber nur der Admin kann sie ändern.'}
      </p>
      <Button type="submit" disabled={!canEdit || isSaving}>
        {isSaving ? 'Speichert…' : 'Organisation speichern'}
      </Button>
    </CardFooter>
  );
}

export function OrganizationSettingsForm({
  initialOrganization,
  deletionScope,
}: OrganizationSettingsFormProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run: runSave, isPending: isSaving } = useServerAction(updateOrganizationSettings);
  const canEdit = initialOrganization.role === 'admin';

  const form = useForm<OrganizationSettingsValues>({
    resolver: zodResolver(organizationSettingsSchema),
    defaultValues: {
      name: initialOrganization.name,
      uniqueCode: initialOrganization.uniqueCode,
    },
  });

  useEffect(() => {
    form.reset({
      name: initialOrganization.name,
      uniqueCode: initialOrganization.uniqueCode,
    });
  }, [form, initialOrganization.name, initialOrganization.uniqueCode]);

  const onSubmit = useSaveChangesSubmit(form, async (values) => {
    if (!canEdit) {
      return;
    }

    try {
      const result = await runSave(values);

      if (!result.success) {
        showSaveFailure(form, result.error, showBanner);
        return;
      }

      form.reset({
        name: result.name,
        uniqueCode: result.uniqueCode,
      });
      router.refresh();
      showBanner({
        message: 'Die Organisation wurde gespeichert.',
        variant: 'success',
      });
    } catch {
      showBanner({ message: ERROR_MESSAGES.update_failed, variant: 'error' });
    }
  });

  return (
    <div className="space-y-6">
      <OrganizationDetailsCard
        roleLabel={getRoleLabel(initialOrganization.role)}
        createdAtLabel={initialOrganization.createdAtLabel}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Allgemeine Angaben
            <InlinePending active={isSaving} label="Organisation wird gespeichert" />
          </CardTitle>
          <CardDescription>
            Admins können den Organisationsnamen und den Code für den Beitritt pflegen.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-4 pb-8">
              <OrganizationFields form={form} disabled={!canEdit || isSaving} />
            </CardContent>
            <OrganizationSaveFooter canEdit={canEdit} isSaving={isSaving} />
          </form>
        </Form>
      </Card>

      <DangerZoneCard orgName={initialOrganization.name} canEdit={canEdit} deletionScope={deletionScope} />
    </div>
  );
}

function DangerZoneCard({
  orgName,
  canEdit,
  deletionScope,
}: {
  orgName: string;
  canEdit: boolean;
  deletionScope: OrganizationDeletionScope | 'load_failed' | null;
}) {
  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>Gefahrenzone</CardTitle>
        <CardDescription>
          Löscht die Organisation dauerhaft inklusive Mitgliedschaften und Einladungen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Diese Aktion sollte nur genutzt werden, wenn die Organisation wirklich nicht mehr benötigt wird.
        </p>
        {deletionScope === 'load_failed' ? (
          <RegionLoadError title="Der Umfang der Löschung konnte nicht geladen werden">
            Versuche es in einem Moment erneut.
          </RegionLoadError>
        ) : (
          <DeleteOrgDialog orgName={orgName} scope={canEdit ? deletionScope : null} />
        )}
        {!canEdit ? (
          <p className="text-sm text-muted-foreground">Nur Admins können die Organisation löschen.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
