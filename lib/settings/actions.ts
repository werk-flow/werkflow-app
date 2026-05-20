'use server';

import { updateTag } from 'next/cache';

import { CACHE_TAGS, getAuthenticatedUser } from '@/lib/data/cached';
import { PROFILE_AVATAR_BUCKET } from '@/lib/profile-avatar';
import type { ProfileSettingsValues } from '@/lib/settings/schemas';
import { profileSettingsSchema } from '@/lib/settings/schemas';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type UpdateProfileResult =
  | { success: true; firstName: string; lastName: string }
  | { success: false; error: 'not_authenticated' | 'invalid_input' | 'update_failed' };

type UpdateProfileAvatarInput = {
  avatarPath: string;
  previousAvatarPath?: string | null;
};

export type UpdateProfileAvatarResult =
  | { success: true; avatarPath: string }
  | {
      success: false;
      error: 'not_authenticated' | 'invalid_input' | 'update_failed';
    };

export type RemoveProfileAvatarResult =
  | { success: true }
  | { success: false; error: 'not_authenticated' | 'update_failed' };

function isValidAvatarPath(userId: string, avatarPath: string): boolean {
  const startsWithUserId = avatarPath.startsWith(`${userId}/`);
  const hasValidLength = avatarPath.length > userId.length + 5;
  const hasInvalidSegments = avatarPath
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..');
  const hasBackslash = avatarPath.includes('\\');

  return startsWithUserId && hasValidLength && !hasInvalidSegments && !hasBackslash;
}

export async function updateProfileSettings(
  input: ProfileSettingsValues
): Promise<UpdateProfileResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const parsed = profileSettingsSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const supabase = await createSupabaseServerClient();
  const { firstName, lastName } = parsed.data;

  const { error } = await supabase
    .from('profiles')
    .update({
      first_name: firstName,
      last_name: lastName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .single();

  if (error) {
    console.error('Error updating profile settings:', error);
    return { success: false, error: 'update_failed' };
  }

  updateTag(CACHE_TAGS.profile(user.id));

  return {
    success: true,
    firstName,
    lastName,
  };
}

export async function updateProfileAvatar(
  input: UpdateProfileAvatarInput
): Promise<UpdateProfileAvatarResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  if (!isValidAvatarPath(user.id, input.avatarPath)) {
    return { success: false, error: 'invalid_input' };
  }

  if (
    input.previousAvatarPath &&
    !isValidAvatarPath(user.id, input.previousAvatarPath)
  ) {
    return { success: false, error: 'invalid_input' };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from('profiles')
    .update({
      avatar_path: input.avatarPath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .single();

  if (error) {
    console.error('Error updating profile avatar:', error);
    return { success: false, error: 'update_failed' };
  }

  if (input.previousAvatarPath && input.previousAvatarPath !== input.avatarPath) {
    const { error: removeError } = await supabase.storage
      .from(PROFILE_AVATAR_BUCKET)
      .remove([input.previousAvatarPath]);

    if (removeError) {
      console.error('Error removing previous profile avatar:', removeError);
    }
  }

  updateTag(CACHE_TAGS.profile(user.id));

  return {
    success: true,
    avatarPath: input.avatarPath,
  };
}

export async function removeProfileAvatar(): Promise<RemoveProfileAvatarResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const supabase = await createSupabaseServerClient();
  const { data: profile, error: readError } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', user.id)
    .single();

  if (readError) {
    console.error('Error reading current profile avatar:', readError);
    return { success: false, error: 'update_failed' };
  }

  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      avatar_path: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)
    .select('id')
    .single();

  if (updateError) {
    console.error('Error removing profile avatar:', updateError);
    return { success: false, error: 'update_failed' };
  }

  if (profile?.avatar_path && isValidAvatarPath(user.id, profile.avatar_path)) {
    const { error: removeError } = await supabase.storage
      .from(PROFILE_AVATAR_BUCKET)
      .remove([profile.avatar_path]);

    if (removeError) {
      console.error('Error deleting profile avatar from storage:', removeError);
    }
  }

  updateTag(CACHE_TAGS.profile(user.id));

  return { success: true };
}
