import { createAdminClient } from './shared';

// The UI never exposes the object key behind an uploaded document; the canary
// download round-trip needs it to prove the bytes actually landed in R2.
export async function getDocumentStoragePathByName(
  orgId: string,
  displayName: string,
): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("documents")
    .select("storage_path")
    .eq("organization_id", orgId)
    // The stored display name keeps the file extension; callers pass the same
    // extension-less name the UI assertions use.
    .ilike("display_name", `${displayName}%`)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `No document named ${displayName} found: ${error?.message}`,
    );
  }
  return data.storage_path as string;
}
