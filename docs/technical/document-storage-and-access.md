# Document storage and access

Rules for document bytes, storage paths, signed URLs, access, links, trash and versions. [document-management.md](../features/document-management.md) owns what users can do.

## Bytes and metadata

Postgres holds metadata: folders, documents, links, categories, trash state, versions, audit events. A private R2 bucket in the EU jurisdiction holds bytes ([environments](environments.md) maps backends to buckets).

- Metadata and bytes target the same environment.
- `documents.storage_bucket` keeps the logical label `organization-documents`, not the bucket name.
- The server authorizes a transfer and signs a short-lived URL; the browser moves the bytes. Server-generated files (artifact exports, handover packages, payroll exports) are the one exception: the server writes them with `putStorageObject`.
- `lib/documents/storage-path.ts` builds `{organizationId}/{documentId}/{sanitizedFileName}` and the `versions/{versionNumber}-…` path. A path never changes; rename and move update metadata only.
- `lib/storage/r2.ts` refuses a key outside the given organization, and a copy, put, delete or list whose keys do not share one organization prefix.
- A view URL renders inline only for MIME types safe to render; every other type downloads. The viewer fetches a new URL each time it opens.

## Upload flow

1. `createDocumentUploadTicket` authorizes user, organization, target and folder, and returns a signed PUT URL with the content type pinned. The URL writes a staging key (`<organization>/staging/...`), never the document's key.
2. The browser PUTs the bytes to R2.
3. `finalizeDocumentUpload` authorizes again, recomputes the path on the server, and copies the staging object there (`promoteUploadedObject`). A HEAD request checks the copy's size and content type. One database function inserts metadata, link and audit events.

- Only the server writes a key a row references. A still-valid signed URL reaches only the staging key after finalize.
- A finalize that fails after the copy deletes the copy, unless a concurrent finalize committed it. A finalize refused before the copy deletes the staging object.
- `DOCUMENT_MAX_FILE_SIZE_BYTES` applies at the ticket and again to the copy.
- Protected personnel uploads (`createPersonnelDocumentUploadTicket`, `finalizePersonnelDocumentUpload`) follow the same steps. A signed cleanup capability binds actor, organization, owner, document, file name, class and operation, so a failed finalize removes only its own orphan.
- A handover release renders deterministic customer-safe HTML on the server; a guarded RPC registers it. A failed registration deletes the object only after it proves no committed row references it.

## Links and ownership

A document exists once. A `document_links` row points to exactly one target. A link never moves an object or changes the folder.

- A request upload links to the request; conversion adds a link to the created job or project. Request-linked documents are manager-only.
- Applying a work template creates no file, folder, link, approval or signature.
- A document becomes evidence for an artifact revision only through an explicit relation to that revision. Removing a fulfilment needs a reason.
- A handover release freezes each source's document id, version number and storage path.
- A link to equipment, a service case or a coverage grants an employee nothing.
- While equipment history or a service-case event depends on a link, unlink and permanent deletion are rejected. Organization teardown is the guarded exception.
- A protected personnel file is a `documents` row plus `personnel_documents` metadata keyed to the personnel record. No ordinary link, no folder; the library excludes it.
- Creating a job, project, customer or employee creates no folder. Entity names change and automatic folders go stale. Before automatic folders or AI extraction arrive, update the feature spec with the decided UX.

## Access

Server actions in `lib/documents/actions.ts` and RLS through `app_private` helpers both enforce access. Change both together.

| Action | `admin` and `buero` | `employee` |
| --- | --- | --- |
| `/dokumente` library, folders, trash, audit, versions | Yes | No; the route redirects |
| Upload on a job page | Yes | Only on an assigned job |
| Upload on a project, customer or employee page | Yes | No |
| View or download | Yes | Only when linked to an assigned job, or to a project with an assigned job |
| Rename, move, copy, delete, link, unlink, reclassify, new version | Yes | No |

- Field access follows assigned work: `lib/documents/access.ts` decides it, and `app_private.can_access_document` holds the same rule for Realtime. A customer or employee link alone grants nothing.
- Every project-level write needs a manager, the upload ticket and finalize included. Exporting a project-level `Arbeitsnachweis` is such a write.
- Protected personnel documents: the affected employee reads a version only through an unrevoked release of that version, and can upload requested own health evidence. Admin reads all classes. Büro manages only `personnel_standard` and reads no `admin_restricted` or `health_evidence` bytes. Assignment, planning, document access and approval responsibility never widen this. Operational consumers get a status, never bytes.

## Operations

- Move changes metadata only. A folder never moves or copies into itself or its descendants.
- Copy creates new rows and copies each object server-side, without links, with the prefix `Kopie von ` and collision-safe naming.
- Delete is soft; storage keeps the bytes. Restore keeps the folder if it still exists, otherwise uses the root. Permanent delete removes every object and the row.
- Versioning applies to `contract`, `invoice`, `offer` and `report`. No rollback.
- Every mutation writes rows and audit events in one database function call. Storage is not transactional: write an object before the call and discard it on refusal; delete an object only after its row is gone.
- `/dokumente?document=<document-id>` opens that document. Other features link to the library record, never a copy.
- Document readers carry no cache tag. A mutation revalidates its routes with `revalidatePath`.

## Storage cleanup

No feature reports or deletes orphaned objects (a staging object whose finalize never ran). When reconciliation becomes a need, build an admin maintenance page with a reviewed authorization boundary and follow the [recovery runbook](recovery-and-incidents.md#restore-procedure-database): list candidates, never purge by prefix, keep objects for review.
