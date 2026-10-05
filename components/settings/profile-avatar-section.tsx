'use client';

import 'react-easy-crop/react-easy-crop.css';

import { ImagePlus, Loader2, Trash2, User } from 'lucide-react';

import { ProfileAvatarCropControls } from '@/components/settings/profile-avatar-crop-controls';
import { useProfileAvatarUpload } from '@/components/settings/use-profile-avatar-upload';
import { PROFILE_AVATAR_INPUT_ACCEPT } from '@/lib/profile-avatar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ProfileAvatarSection() {
  const {
    profile,
    initials,
    inputRef,
    dialogOpen,
    cropSource,
    crop,
    setCrop,
    zoom,
    setZoom,
    croppedAreaPixels,
    setCroppedAreaPixels,
    isUploading,
    isRemoving,
    resetCropState,
    openFileDialog,
    handleFileChange,
    handleUploadAvatar,
    handleRemoveAvatar,
  } = useProfileAvatarUpload();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Profilbild</CardTitle>
          <CardDescription>
            Lade ein Bild hoch und passe den Ausschnitt vor dem Speichern genau so an, wie es später in der
            App erscheinen soll.
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
              Unterstützt werden gängige Bildformate bis 5 MB. Vor dem Speichern kannst du dein Bild
              zuschneiden und heranzoomen.
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
                    Wird hochgeladen…
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
                      Wird entfernt…
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
        pending={isUploading}
      >
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>Profilbild anpassen</DialogTitle>
            <DialogDescription>
              Verschiebe und zoome dein Bild, bis der runde Ausschnitt für dich passt.
            </DialogDescription>
          </DialogHeader>

          <ProfileAvatarCropControls
            cropSource={cropSource}
            crop={crop}
            zoom={zoom}
            setCrop={setCrop}
            setZoom={setZoom}
            setCroppedAreaPixels={setCroppedAreaPixels}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetCropState} disabled={isUploading}>
              Abbrechen
            </Button>
            <Button type="button" onClick={handleUploadAvatar} disabled={isUploading || !croppedAreaPixels}>
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Speichert…
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
