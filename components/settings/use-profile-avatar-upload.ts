'use client';

import { type Area } from 'react-easy-crop';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createCroppedAvatarBlob } from '@/components/settings/profile-avatar-crop';
import { useBanner } from '@/components/ui/banner';
import { useUserProfile } from '@/components/user/user-profile-context';
import type { UserProfile } from '@/lib/profile-reference';
import { usePendingTask } from '@/hooks/use-server-action';
import {
  PROFILE_AVATAR_ALLOWED_MIME_TYPES,
  PROFILE_AVATAR_BUCKET,
  PROFILE_AVATAR_MAX_FILE_SIZE_BYTES,
} from '@/lib/profile-avatar';
import { removeProfileAvatar, updateProfileAvatar } from '@/lib/settings/actions';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type CropPosition = { x: number; y: number };

type ProfileAvatarUpload = {
  profile: UserProfile | null;
  initials: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  dialogOpen: boolean;
  cropSource: string | null;
  crop: CropPosition;
  setCrop: (crop: CropPosition) => void;
  zoom: number;
  setZoom: (zoom: number) => void;
  croppedAreaPixels: Area | null;
  setCroppedAreaPixels: (area: Area | null) => void;
  isUploading: boolean;
  isRemoving: boolean;
  resetCropState: () => void;
  openFileDialog: () => void;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleUploadAvatar: () => Promise<void>;
  handleRemoveAvatar: () => Promise<void>;
};

type AvatarHandlerContext = {
  supabase: ReturnType<typeof createSupabaseBrowserClient>;
  profile: UserProfile | null;
  refreshProfile: () => Promise<void>;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  cropSource: string | null;
  croppedAreaPixels: Area | null;
  setCropSource: (source: string) => void;
  setCrop: (crop: CropPosition) => void;
  setZoom: (zoom: number) => void;
  setCroppedAreaPixels: (area: Area | null) => void;
  setDialogOpen: (open: boolean) => void;
  runUpload: ReturnType<typeof usePendingTask>['run'];
  runRemove: ReturnType<typeof usePendingTask>['run'];
  resetCropState: () => void;
};

type AvatarHandlers = Pick<
  ProfileAvatarUpload,
  'handleFileChange' | 'handleUploadAvatar' | 'handleRemoveAvatar'
>;

/** The banner sentence for a file the upload refuses, or null when the file is accepted. */
function avatarFileProblem(file: File): string | null {
  if (!PROFILE_AVATAR_ALLOWED_MIME_TYPES.some((mimeType) => mimeType === file.type)) {
    return 'Bitte wähle eine gültige Bilddatei aus.';
  }
  if (file.size > PROFILE_AVATAR_MAX_FILE_SIZE_BYTES) {
    return 'Das Profilbild darf maximal 5 MB groß sein.';
  }
  return null;
}

/** Uploads the cropped image, saves it as the profile picture and drops the upload when the save fails. */
async function uploadCroppedAvatar({
  supabase,
  nextAvatarPath,
  previousAvatarPath,
  cropSource,
  croppedAreaPixels,
  refreshProfile,
  showBanner,
  resetCropState,
}: Pick<AvatarHandlerContext, 'supabase' | 'refreshProfile' | 'showBanner' | 'resetCropState'> & {
  nextAvatarPath: string;
  previousAvatarPath: string | null;
  cropSource: string;
  croppedAreaPixels: Area;
}): Promise<void> {
  try {
    const croppedBlob = await createCroppedAvatarBlob(cropSource, croppedAreaPixels);

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
      previousAvatarPath,
    });

    if (!result.success) {
      await supabase.storage.from(PROFILE_AVATAR_BUCKET).remove([nextAvatarPath]);
      showBanner({
        message: 'Das Profilbild konnte nicht gespeichert werden.',
        variant: 'error',
      });
      return;
    }

    // The action's response renders the route; the profile context reads its own copy.
    await refreshProfile();
    resetCropState();
    showBanner({
      message: 'Dein Profilbild wurde aktualisiert.',
      variant: 'success',
    });
  } catch {
    showBanner({
      message: 'Das Profilbild konnte nicht verarbeitet werden.',
      variant: 'error',
    });
  }
}

async function removeCurrentAvatar({
  refreshProfile,
  showBanner,
}: Pick<AvatarHandlerContext, 'refreshProfile' | 'showBanner'>): Promise<void> {
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
    showBanner({
      message: 'Dein Profilbild wurde entfernt.',
      variant: 'success',
    });
  } catch {
    showBanner({
      message: 'Das Profilbild konnte nicht entfernt werden.',
      variant: 'error',
    });
  }
}

/**
 * File validation, upload and removal. It calls no React hook: it rebuilds the
 * handlers on every render like the inline handlers it replaced, so they always
 * read the current crop state. The hook name lets it receive `resetCropState`,
 * which writes the file input's ref.
 */
function useAvatarHandlers({
  supabase,
  profile,
  refreshProfile,
  showBanner,
  cropSource,
  croppedAreaPixels,
  setCropSource,
  setCrop,
  setZoom,
  setCroppedAreaPixels,
  setDialogOpen,
  runUpload,
  runRemove,
  resetCropState,
}: AvatarHandlerContext): AvatarHandlers {
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const problem = avatarFileProblem(file);
    if (problem !== null) {
      showBanner({ message: problem, variant: 'error' });
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

    const nextAvatarPath = `${profile.id}/${Date.now()}-${crypto.randomUUID()}.jpg`;

    await runUpload(() =>
      uploadCroppedAvatar({
        supabase,
        nextAvatarPath,
        previousAvatarPath: profile.avatarPath,
        cropSource,
        croppedAreaPixels,
        refreshProfile,
        showBanner,
        resetCropState,
      }),
    );
  };

  const handleRemoveAvatar = async () => {
    if (!profile?.avatarPath) {
      return;
    }

    await runRemove(() => removeCurrentAvatar({ refreshProfile, showBanner }));
  };

  return { handleFileChange, handleUploadAvatar, handleRemoveAvatar };
}

/** File selection, crop state, upload and removal of the signed-in user's profile picture. */
export function useProfileAvatarUpload(): ProfileAvatarUpload {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const { profile, refreshProfile } = useUserProfile();
  const { showBanner } = useBanner();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const { run: runUpload, isPending: isUploading } = usePendingTask();
  const { run: runRemove, isPending: isRemoving } = usePendingTask();

  const initials = useMemo(
    () => `${profile?.firstName?.[0] ?? ''}${profile?.lastName?.[0] ?? ''}`.trim(),
    [profile?.firstName, profile?.lastName],
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

  const handlers = useAvatarHandlers({
    supabase,
    profile,
    refreshProfile,
    showBanner,
    cropSource,
    croppedAreaPixels,
    setCropSource,
    setCrop,
    setZoom,
    setCroppedAreaPixels,
    setDialogOpen,
    runUpload,
    runRemove,
    resetCropState,
  });

  return {
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
    ...handlers,
  };
}
