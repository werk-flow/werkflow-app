import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { createSignedDownloadUrl } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { aiFileUrlInputSchema } from './types';
import type { z } from '@/lib/zod';

// A WerkFlow KI file in its thread: its author opens it through a short-lived
// signed URL (B11). Nobody else does: the file belongs to its thread's author.
// A message attaches its uploads in the call that saves it (lib/ai/turn.ts).

/**
 * A ten-minute URL of one of the caller's attached files, shown inline: every
 * allowed type renders safely. Another person's file, another organization's,
 * an unsent one or one that is gone reads as not found.
 */
export async function getAiFileUrl(
  input: z.infer<typeof aiFileUrlInputSchema>,
): Promise<{ success: true; url: string } | ActionFailure> {
  const parsed = aiFileUrlInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  const { orgId, userId } = auth.context;
  const { data, error } = await createSupabaseAdminClient()
    .from('ai_thread_files')
    .select('storage_path, file_name')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('id', parsed.data.fileId)
    .not('item_id', 'is', null)
    .maybeSingle();
  if (error) {
    logError('getAiFileUrl: file read failed', error);
    return { success: false, error: 'load_failed' };
  }
  if (!data) return { success: false, error: 'not_found' };
  try {
    const url = await createSignedDownloadUrl({
      organizationId: orgId,
      path: data.storage_path,
      downloadFileName: data.file_name,
    });
    return { success: true, url };
  } catch (signError) {
    logError('getAiFileUrl: signing failed', signError);
    return { success: false, error: 'load_failed' };
  }
}
