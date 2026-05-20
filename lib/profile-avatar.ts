import { getSupabaseUrl } from '@/lib/env/public';

export const PROFILE_AVATAR_BUCKET = 'profile-avatars';
export const PROFILE_AVATAR_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const PROFILE_AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
] as const;
export const PROFILE_AVATAR_INPUT_ACCEPT =
  PROFILE_AVATAR_ALLOWED_MIME_TYPES.join(',');

export function getProfileAvatarUrl(
  avatarPath: string | null | undefined
): string | null {
  if (!avatarPath) {
    return null;
  }

  return `${getSupabaseUrl()}/storage/v1/object/public/${PROFILE_AVATAR_BUCKET}/${avatarPath}`;
}
