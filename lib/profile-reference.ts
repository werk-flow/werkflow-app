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
