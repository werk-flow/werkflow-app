// Boundary schemas for the document Server Actions in `./actions`. Every
// argument of those actions arrives from the network unchecked, so each action
// parses it through one of these schemas before its first use (AGENTS.md
// "3. Security"). The input types the actions declare are inferred from here.

import { z } from '@/lib/zod';

import { uuidSchema } from '@/lib/validation/uuid';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_LIBRARY_LINK_FILTERS,
  DOCUMENT_LIBRARY_SORTS,
  DOCUMENT_LIBRARY_VIEWS,
} from './types';

// A blank folder or target id means "none": the actions treat it like null.
const optionalIdSchema = uuidSchema.or(z.literal('')).nullable().optional();
const nameSchema = z.string().max(500);
const fileNameSchema = z.string().max(1000);
const searchQuerySchema = z.string().max(1000).nullable().optional();
const idListSchema = z.array(uuidSchema).max(1000).optional();
const documentCategorySchema = z.enum(DOCUMENT_CATEGORIES);

/** Reads `value` through `schema`; null when the value does not match. */
export function parseActionInput<Output>(schema: z.ZodType<Output>, value: unknown): Output | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;

export const documentLibraryInputSchema = z.object({
  page: z.number().optional(),
  folderPage: z.number().optional(),
  folderId: optionalIdSchema,
  view: z.enum(DOCUMENT_LIBRARY_VIEWS).optional(),
  searchQuery: searchQuerySchema,
  sort: z.enum(DOCUMENT_LIBRARY_SORTS).optional(),
  category: documentCategorySchema.or(z.literal('all')).nullable().optional(),
  linkFilter: z.enum(DOCUMENT_LIBRARY_LINK_FILTERS).nullable().optional(),
});
export type DocumentLibraryInput = z.input<typeof documentLibraryInputSchema>;

export const attachableDocumentsInputSchema = z.object({
  targetType: z.enum([
    'job',
    'project',
    'client',
    'employee',
    'equipment',
    'service_case',
    'maintenance_coverage',
  ]),
  targetId: uuidSchema,
  searchQuery: searchQuerySchema,
  category: documentCategorySchema.or(z.literal('all')).nullable().optional(),
});
export type AttachableDocumentsInput = z.input<typeof attachableDocumentsInputSchema>;

export const projectOverviewJobsSchema = z
  .array(z.object({ id: uuidSchema, jobNumber: z.string().max(100).nullable(), title: z.string().max(1000) }))
  .max(2000);

export const createFolderInputSchema = z.object({ name: nameSchema, parentFolderId: optionalIdSchema });
export type CreateFolderInput = z.input<typeof createFolderInputSchema>;

export const renameFolderInputSchema = z.object({ folderId: uuidSchema, name: nameSchema });
export type RenameFolderInput = z.input<typeof renameFolderInputSchema>;

export const moveFolderInputSchema = z.object({ folderId: uuidSchema, parentFolderId: optionalIdSchema });
export type MoveFolderInput = z.input<typeof moveFolderInputSchema>;

export const copyFolderInputSchema = z.object({
  folderId: uuidSchema,
  targetParentFolderId: optionalIdSchema,
});
export type CopyFolderInput = z.input<typeof copyFolderInputSchema>;

const contextTargetIdSchema = uuidSchema.or(z.literal(''));
const documentUploadTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('library'), folderId: optionalIdSchema }),
  z.object({ kind: z.literal('job'), jobId: contextTargetIdSchema, folderId: optionalIdSchema }),
  z.object({ kind: z.literal('project'), projectId: contextTargetIdSchema, folderId: optionalIdSchema }),
  z.object({ kind: z.literal('client'), clientId: contextTargetIdSchema, folderId: optionalIdSchema }),
  z.object({ kind: z.literal('employee'), employeeId: contextTargetIdSchema, folderId: optionalIdSchema }),
  z.object({ kind: z.literal('request'), requestId: contextTargetIdSchema, folderId: optionalIdSchema }),
  z.object({ kind: z.literal('equipment'), equipmentId: contextTargetIdSchema, folderId: optionalIdSchema }),
  z.object({
    kind: z.literal('service_case'),
    serviceCaseId: contextTargetIdSchema,
    folderId: optionalIdSchema,
  }),
  z.object({
    kind: z.literal('maintenance_coverage'),
    maintenanceCoverageId: contextTargetIdSchema,
    folderId: optionalIdSchema,
  }),
]);
export type ParsedDocumentUploadTarget = z.output<typeof documentUploadTargetSchema>;

const uploadFileSchema = z.object({
  fileName: fileNameSchema,
  fileSizeBytes: z.number(),
  mimeType: z.string().max(255).nullable().optional(),
});

export const createDocumentUploadTicketInputSchema = documentUploadTargetSchema.and(uploadFileSchema);
export type CreateDocumentUploadTicketInput = z.input<typeof createDocumentUploadTicketInputSchema>;

export const finalizeDocumentUploadInputSchema = documentUploadTargetSchema.and(
  z.object({
    documentId: uuidSchema,
    fileName: fileNameSchema,
    category: z.string().max(100).nullable().optional(),
  }),
);
export type FinalizeDocumentUploadInput = z.input<typeof finalizeDocumentUploadInputSchema>;

export const renameDocumentInputSchema = z.object({ documentId: uuidSchema, displayName: nameSchema });
export type RenameDocumentInput = z.input<typeof renameDocumentInputSchema>;

export const updateDocumentCategoryInputSchema = z.object({
  documentId: uuidSchema,
  category: documentCategorySchema,
});
export type UpdateDocumentCategoryInput = z.input<typeof updateDocumentCategoryInputSchema>;

export const moveDocumentInputSchema = z.object({ documentId: uuidSchema, folderId: optionalIdSchema });
export type MoveDocumentInput = z.input<typeof moveDocumentInputSchema>;

export const copyDocumentInputSchema = z.object({ documentId: uuidSchema, targetFolderId: optionalIdSchema });
export type CopyDocumentInput = z.input<typeof copyDocumentInputSchema>;

export const unlinkDocumentInputSchema = z.object({ linkId: uuidSchema });
export type UnlinkDocumentInput = z.input<typeof unlinkDocumentInputSchema>;

export const updateDocumentLinksInputSchema = z.object({
  documentId: uuidSchema,
  addJobIds: idListSchema,
  addProjectIds: idListSchema,
  addClientIds: idListSchema,
  addEmployeeIds: idListSchema,
  addEquipmentIds: idListSchema,
  addServiceCaseIds: idListSchema,
  addMaintenanceCoverageIds: idListSchema,
  removeLinkIds: idListSchema,
});

const optionalTargetIdSchema = contextTargetIdSchema.optional();
export const linkDocumentsToTargetInputSchema = z.object({
  documentIds: z.array(uuidSchema).max(1000),
  jobId: optionalTargetIdSchema,
  projectId: optionalTargetIdSchema,
  clientId: optionalTargetIdSchema,
  employeeId: optionalTargetIdSchema,
  equipmentId: optionalTargetIdSchema,
  serviceCaseId: optionalTargetIdSchema,
  maintenanceCoverageId: optionalTargetIdSchema,
});

export const signedUrlOptionsSchema = z.object({ download: z.boolean().optional() });

export const createDocumentVersionUploadTicketInputSchema = uploadFileSchema.extend({
  documentId: uuidSchema,
});
export type CreateDocumentVersionUploadTicketInput = z.input<
  typeof createDocumentVersionUploadTicketInputSchema
>;

export const finalizeDocumentVersionUploadInputSchema = z.object({
  documentId: uuidSchema,
  versionNumber: z.number().int(),
  fileName: fileNameSchema,
});
export type FinalizeDocumentVersionUploadInput = z.input<typeof finalizeDocumentVersionUploadInputSchema>;
