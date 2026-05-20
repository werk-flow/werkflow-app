'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { DeleteOrgDialog } from '@/components/org/delete-org-dialog';
import { useSettingsBanner } from '@/components/settings/settings-banner-provider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { updateOrganizationSettings } from '@/lib/org/settings-actions';
import {
  ORGANIZATION_CODE_LENGTH,
  organizationSettingsSchema,
  type OrganizationSettingsValues,
} from '@/lib/org/schemas';
import { getRoleLabel } from '@/lib/roles';

const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Du bist nicht angemeldet.',
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
  no_changes: 'Es wurden keine Änderungen vorgenommen.',
  update_failed: 'Die Organisation konnte nicht gespeichert werden.',
};

type OrganizationSettingsFormProps = {
  initialOrganization: {
    name: string;
    uniqueCode: string;
    createdAtLabel: string;
    role: 'admin' | 'buero' | 'employee';
  };
};

export function OrganizationSettingsForm({
  initialOrganization,
}: OrganizationSettingsFormProps) {
  const router = useRouter();
  const { showBanner } = useSettingsBanner();
  const [isSaving, setIsSaving] = useState(false);
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

  const onSubmit = form.handleSubmit(async (values) => {
    if (!canEdit) {
      return;
    }

    setIsSaving(true);

    try {
      const result = await updateOrganizationSettings(values);

      if (!result.success) {
        if (result.error === 'name_taken') {
          form.setError('name', {
            message: ERROR_MESSAGES.name_taken,
          });
          return;
        }

        if (result.error === 'code_taken' || result.error === 'code_invalid') {
          form.setError('uniqueCode', {
            message: ERROR_MESSAGES[result.error],
          });
          return;
        }

        if (
          result.error === 'name_required' ||
          result.error === 'name_too_short' ||
          result.error === 'name_too_long'
        ) {
          form.setError('name', {
            message: ERROR_MESSAGES[result.error],
          });
          return;
        }

        if (result.error === 'code_required') {
          form.setError('uniqueCode', {
            message: ERROR_MESSAGES.code_required,
          });
          return;
        }

        showBanner({
          message: ERROR_MESSAGES[result.error] ?? ERROR_MESSAGES.update_failed,
          variant: 'error',
        });
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
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <div className="space-y-6 pb-28">
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
            <p className="text-sm text-muted-foreground">
              {getRoleLabel(initialOrganization.role)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Erstellt am</p>
            <p className="text-sm text-muted-foreground">
              {initialOrganization.createdAtLabel}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allgemeine Angaben</CardTitle>
          <CardDescription>
            Admins können den Organisationsnamen und den Code für den Beitritt pflegen.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="space-y-4 pb-8">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name der Organisation</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="organization"
                        disabled={!canEdit || isSaving}
                        maxLength={100}
                        placeholder="z.B. WerkFlow Nord"
                      />
                    </FormControl>
                    <FormDescription>
                      Pro Admin darf jeder Organisationsname nur einmal vergeben sein.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="uniqueCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organisationscode</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoCapitalize="characters"
                        autoComplete="off"
                        className="font-mono uppercase tracking-[0.3em]"
                        disabled={!canEdit || isSaving}
                        maxLength={ORGANIZATION_CODE_LENGTH}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value.toUpperCase().replace(/\s+/g, '')
                          )
                        }
                        placeholder="ABC123"
                        spellCheck={false}
                      />
                    </FormControl>
                    <FormDescription>
                      Dieser Code muss organisationsweit eindeutig sein, damit neue Nutzer gezielt
                      beitreten können.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col items-start gap-3 border-t sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {canEdit
                  ? 'Änderungen wirken sich direkt auf alle Mitglieder dieser Organisation aus.'
                  : 'Du kannst diese Daten einsehen, aber nur der Admin kann sie ändern.'}
              </p>
              <Button
                type="submit"
                disabled={!canEdit || isSaving || !form.formState.isDirty}
              >
                {isSaving ? 'Speichert...' : 'Organisation speichern'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Gefahrenzone</CardTitle>
          <CardDescription>
            Löscht die Organisation dauerhaft inklusive Mitgliedschaften und Einladungen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Diese Aktion sollte nur genutzt werden, wenn die Organisation wirklich nicht mehr
            benötigt wird.
          </p>
          <DeleteOrgDialog
            disabled={!canEdit}
            orgName={initialOrganization.name}
          />
          {!canEdit ? (
            <p className="text-sm text-muted-foreground">
              Nur Admins können die Organisation löschen.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
