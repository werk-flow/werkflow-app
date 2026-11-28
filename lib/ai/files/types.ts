import type { ActionResult } from '@/lib/action-result';
import { AI_UPLOAD_LIMITS } from '@/lib/ai/limits';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The inputs and results of a WerkFlow KI file's upload (lib/ai/files/upload.ts),
// shared by its actions and the composer.

export const createAiFileUploadTicketInputSchema = z.strictObject({
  organizationId: uuidSchema,
  mimeType: z.string().max(100),
  fileSizeBytes: z.number().int(),
});

export const finalizeAiFileUploadInputSchema = z.strictObject({
  organizationId: uuidSchema,
  fileId: uuidSchema,
  fileName: z.string().trim().min(1).max(200),
});

export const aiFileUrlInputSchema = z.object({ organizationId: uuidSchema, fileId: uuidSchema });

/** The file ids a message attaches, in the order the composer shows them. */
export const aiMessageFileIds = z
  .array(uuidSchema)
  .max(AI_UPLOAD_LIMITS.maxFilesPerMessage)
  .refine((ids) => new Set(ids).size === ids.length);

export type AiFileUploadTicketResult = ActionResult<{ fileId: string; uploadUrl: string }>;

/** A finalized upload as the composer keeps it until its message is sent. */
export type AiUploadedFile = {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  pages: number | null;
};

export type AiFileFinalizeResult = ActionResult<{ file: AiUploadedFile }>;
