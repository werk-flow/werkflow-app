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
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarPath: string | null;
  avatarUrl: string | null;
};

/** Whether the referenced person is still a member of the organization the record belongs to. */
export type ProfileReferenceMembership = 'member' | 'former';

/**
 * The reference for a loaded profile row; a missing row (deleted or unreadable profile) is null.
 * A former member stays named on the record, but the reader gets neither the
 * person's current email nor their avatar: both belong to the person, not to the record.
 */
export function toProfileReference(
  profile?: ProfileReferenceRow | null,
  membership: ProfileReferenceMembership = 'member',
): ProfileReference | null {
  if (!profile) return null;
  const isMember = membership === 'member';
  return {
    userId: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: isMember ? profile.email : null,
    avatarPath: isMember ? profile.avatar_path : null,
  };
}
