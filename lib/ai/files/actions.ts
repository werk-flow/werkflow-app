'use server';

import { resolveActionContextFor } from '@/lib/org/action-context';
import type { ActionResult } from '@/lib/action-result';
import { discardUploadedAiFile, issueAiFileUploadTicket, registerUploadedAiFile } from './upload';
import {
  type AiFileFinalizeResult,
  type AiFileUploadTicketResult,
  aiFileUrlInputSchema,
  createAiFileUploadTicketInputSchema,
  finalizeAiFileUploadInputSchema,
} from './types';
import type { z } from '@/lib/zod';

// The two steps of a WerkFlow KI upload around the browser's PUT
// (lib/ai/files/upload.ts). Neither takes file bytes.

export async function createAiFileUploadTicket(
  rawInput: z.input<typeof createAiFileUploadTicketInputSchema>,
): Promise<AiFileUploadTicketResult> {
  const parsed = createAiFileUploadTicketInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  return issueAiFileUploadTicket(auth.context, parsed.data);
}

export async function finalizeAiFileUpload(
  rawInput: z.input<typeof finalizeAiFileUploadInputSchema>,
): Promise<AiFileFinalizeResult> {
  const parsed = finalizeAiFileUploadInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  const { fileId, fileName } = parsed.data;
  return registerUploadedAiFile(auth.context, { fileId, fileName });
}

/** Removes an upload the person took out of their draft before sending; a failure leaves it to the daily job. */
export async function discardAiFile(rawInput: z.input<typeof aiFileUrlInputSchema>): Promise<ActionResult> {
  const parsed = aiFileUrlInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return auth;
  return discardUploadedAiFile(auth.context, parsed.data.fileId);
}
