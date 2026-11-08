import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { readInBatches } from '@/lib/supabase/query-batches';

/** The profile columns a person reference is built from. */
type ProfileReferenceRow = Pick<
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

/**
 * A former member stays named on the record, but the reader gets neither the
 * person's current email nor their avatar: both belong to the person, not to the record.
 */
function toProfileReference(profile: ProfileReferenceRow, isMember: boolean): ProfileReference {
  return {
    userId: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: isMember ? profile.email : null,
    avatarPath: isMember ? profile.avatar_path : null,
  };
}

/**
 * The references of the people a record of the organization names, by user id.
 * One `list_profile_references` read per batch returns each profile with its
 * membership in the organization. An id without a profile (deleted or
 * unreadable) has no entry. A failed read returns its error and no reference,
 * so no caller can show a person whose membership it does not know.
 */
export async function readProfileReferences(
  admin: AdminClient,
  organizationId: string,
  userIds: readonly string[],
): Promise<{ data: ReadonlyMap<string, ProfileReference>; error: { code: string; message: string } | null }> {
  const { data, error } = await readInBatches(userIds, (batch) =>
    admin.rpc('list_profile_references', { p_organization_id: organizationId, p_user_ids: [...batch] }),
  );
  if (error) return { data: new Map(), error };
  return {
    data: new Map(data.map((profile) => [profile.id, toProfileReference(profile, profile.is_member)])),
    error: null,
  };
}
