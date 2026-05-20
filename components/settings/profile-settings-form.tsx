'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';

import { updateProfileSettings } from '@/lib/settings/actions';
import {
  type ProfileSettingsValues,
  profileSettingsSchema,
} from '@/lib/settings/schemas';
import { ProfileAvatarSection } from '@/components/settings/profile-avatar-section';
import { useSettingsBanner } from '@/components/settings/settings-banner-provider';
import { useUserProfile } from '@/components/user/user-profile-context';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

export function ProfileSettingsForm() {
  const router = useRouter();
  const { profile, refreshProfile } = useUserProfile();
  const { showBanner } = useSettingsBanner();
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<ProfileSettingsValues>({
    resolver: zodResolver(profileSettingsSchema),
    defaultValues: {
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
    },
  });

  useEffect(() => {
    form.reset({
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
    });
  }, [form, profile?.firstName, profile?.lastName]);

  const onSubmit = form.handleSubmit(async (values) => {
    setIsSaving(true);

    try {
      const result = await updateProfileSettings(values);

      if (!result.success) {
        showBanner({
          message: 'Dein Profil konnte nicht gespeichert werden.',
          variant: 'error',
        });
        return;
      }

      await refreshProfile();
      router.refresh();
      showBanner({
        message: 'Dein Profil wurde gespeichert.',
        variant: 'success',
      });
    } finally {
      setIsSaving(false);
    }
  });

  return (
    <div className="space-y-6">
      <ProfileAvatarSection />

      <Card>
        <CardHeader>
          <CardTitle>Anzeigename</CardTitle>
          <CardDescription>
            Diese Angaben erscheinen in der Sidebar und an weiteren Stellen der App als dein Name.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={onSubmit}>
            <CardContent className="grid gap-4 pb-6 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vorname</FormLabel>
                    <FormControl>
                      <Input placeholder="Max" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nachname</FormLabel>
                    <FormControl>
                      <Input placeholder="Mustermann" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="justify-end border-t">
              <Button
                type="submit"
                disabled={isSaving || !form.formState.isDirty}
              >
                {isSaving ? 'Speichert...' : 'Profil speichern'}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
