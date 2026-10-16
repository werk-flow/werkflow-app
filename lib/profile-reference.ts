import type { Database } from '@/lib/supabase/database.types';

/** The profile columns a person reference is built from. */
export type ProfileReferenceRow = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'first_name' | 'last_name' | 'email' | 'avatar_path'
>;

/** A person named on a record: an uploader, a creator, the last person who changed a status. */
export type ProfileReference = {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatarPath: string | null;
};

/** The signed-in user's own profile, as the app shell reads it and the profile context holds it. */
export type UserProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarPath: string | null;
  avatarUrl: string | null;
};

/** The reference for a loaded profile row; a missing row (deleted or unreadable profile) is null. */
export function toProfileReference(profile?: ProfileReferenceRow | null): ProfileReference | null {
  if (!profile) return null;
  return {
    userId: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    avatarPath: profile.avatar_path,
  };
}
