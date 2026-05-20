'use client';

import 'react-easy-crop/react-easy-crop.css';

import Cropper, { type Area } from 'react-easy-crop';
import { ImagePlus, Loader2, Trash2, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  removeProfileAvatar,
  updateProfileAvatar,
} from '@/lib/settings/actions';
import { useSettingsBanner } from '@/components/settings/settings-banner-provider';
import {
  PROFILE_AVATAR_ALLOWED_MIME_TYPES,
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_INPUT_ACCEPT,
  PROFILE_AVATAR_MAX_FILE_SIZE_BYTES,
} from '@/lib/profile-avatar';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useUserProfile } from '@/components/user/user-profile-context';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const OUTPUT_AVATAR_SIZE = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error('Das Bild konnte nicht geladen werden.'));
    image.src = src;
  });
}

async function createCroppedAvatarBlob(
  imageSrc: string,
  cropAreaPixels: Area
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_AVATAR_SIZE;
  canvas.height = OUTPUT_AVATAR_SIZE;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Die Bildverarbeitung konnte nicht initialisiert werden.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    cropAreaPixels.x,
    cropAreaPixels.y,
    cropAreaPixels.width,
    cropAreaPixels.height,
    0,
    0,
    OUTPUT_AVATAR_SIZE,
    OUTPUT_AVATAR_SIZE
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Das Bild konnte nicht exportiert werden.'));
          return;
        }

        resolve(blob);
      },
      'image/jpeg',
      0.92
    );
  });
}

export function ProfileAvatarSection() {
  const router = useRouter();
  const { profile, refreshProfile } = useUserProfile();
  const { showBanner } = useSettingsBanner();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const initials = useMemo(
    () =>
      `${profile?.firstName?.[0] ?? ''}${profile?.lastName?.[0] ?? ''}`.trim(),
    [profile?.firstName, profile?.lastName]
  );

  const resetCropState = useCallback(() => {
    setDialogOpen(false);
    setCropSource((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    return () => {
      if (cropSource) {
        URL.revokeObjectURL(cropSource);
      }
    };
  }, [cropSource]);

  const openFileDialog = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!(PROFILE_AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      showBanner({
        message: 'Bitte wähle eine gültige Bilddatei aus.',
        variant: 'error',
      });
      event.target.value = '';
      return;
    }

    if (file.size > PROFILE_AVATAR_MAX_FILE_SIZE_BYTES) {
      showBanner({
        message: 'Das Profilbild darf maximal 5 MB groß sein.',
        variant: 'error',
      });
      event.target.value = '';
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setCropSource(objectUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setDialogOpen(true);
  };

  const handleUploadAvatar = async () => {
    if (!profile?.id || !cropSource || !croppedAreaPixels) {
      showBanner({
        message: 'Das Profilbild konnte nicht vorbereitet werden.',
        variant: 'error',
      });
      return;
    }

    setIsUploading(true);

    const supabase = createSupabaseBrowserClient();
    const nextAvatarPath = `${profile.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;

    try {
      const croppedBlob = await createCroppedAvatarBlob(
        cropSource,
        croppedAreaPixels
      );

      const { error: uploadError } = await supabase.storage
        .from(PROFILE_AVATAR_BUCKET)
        .upload(nextAvatarPath, croppedBlob, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
        });

      if (uploadError) {
        showBanner({
          message: 'Das Profilbild konnte nicht hochgeladen werden.',
          variant: 'error',
        });
        return;
      }

      const result = await updateProfileAvatar({
        avatarPath: nextAvatarPath,
        previousAvatarPath: profile.avatarPath,
      });

      if (!result.success) {
        await supabase.storage
          .from(PROFILE_AVATAR_BUCKET)
          .remove([nextAvatarPath]);
        showBanner({
          message: 'Das Profilbild konnte nicht gespeichert werden.',
          variant: 'error',
        });
        return;
      }

      await refreshProfile();
      router.refresh();
      resetCropState();
      showBanner({
        message: 'Dein Profilbild wurde aktualisiert.',
        variant: 'success',
      });
    } catch (error) {
      console.error('Error uploading profile avatar:', error);
      showBanner({
        message: 'Das Profilbild konnte nicht verarbeitet werden.',
        variant: 'error',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!profile?.avatarPath) {
      return;
    }

    setIsRemoving(true);

    try {
      const result = await removeProfileAvatar();
      if (!result.success) {
        showBanner({
          message: 'Das Profilbild konnte nicht entfernt werden.',
          variant: 'error',
        });
        return;
      }

      await refreshProfile();
      router.refresh();
      showBanner({
        message: 'Dein Profilbild wurde entfernt.',
        variant: 'success',
      });
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Profilbild</CardTitle>
          <CardDescription>
            Lade ein Bild hoch und passe den Ausschnitt vor dem Speichern genau so an,
            wie es später in der App erscheinen soll.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-24 ring-1 ring-border">
            {profile?.avatarUrl ? (
              <AvatarImage
                src={profile.avatarUrl}
                alt={`Profilbild von ${profile.firstName} ${profile.lastName}`}
              />
            ) : null}
            <AvatarFallback className="bg-muted text-base font-semibold text-muted-foreground">
              {initials || <User className="size-7" />}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 space-y-3">
            <p className="text-sm text-muted-foreground">
              Unterstützt werden gängige Bildformate bis 5 MB. Vor dem Speichern
              kannst du dein Bild zuschneiden und heranzoomen.
            </p>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                onClick={openFileDialog}
                disabled={isUploading || isRemoving}
                className="cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Wird hochgeladen...
                  </>
                ) : (
                  <>
                    <ImagePlus className="mr-2 size-4" />
                    {profile?.avatarPath ? 'Profilbild ändern' : 'Profilbild hochladen'}
                  </>
                )}
              </Button>

              {profile?.avatarPath ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRemoveAvatar}
                  disabled={isUploading || isRemoving}
                >
                  {isRemoving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Wird entfernt...
                    </>
                  ) : (
                    <>
                      <Trash2 className="mr-2 size-4" />
                      Profilbild entfernen
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={PROFILE_AVATAR_INPUT_ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetCropState();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Profilbild anpassen</DialogTitle>
            <DialogDescription>
              Verschiebe und zoome dein Bild, bis der runde Ausschnitt für dich passt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="relative h-80 overflow-hidden rounded-xl bg-black">
              {cropSource ? (
                <Cropper
                  image={cropSource}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={(_, croppedPixels) =>
                    setCroppedAreaPixels(croppedPixels)
                  }
                />
              ) : null}
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Zoom
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="w-full accent-primary"
              />
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={resetCropState}
              disabled={isUploading}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              onClick={handleUploadAvatar}
              disabled={isUploading || !croppedAreaPixels}
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Speichert...
                </>
              ) : (
                'Profilbild speichern'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
