# Document storage and access

Rules for document bytes, storage paths, signed URLs, access, links, trash, versions, retention and filing. [document-management.md](../features/document-management.md) owns what users can do.

## Bytes and metadata

Postgres holds metadata: folders, documents, links, categories, trash state, versions, audit events. A private R2 bucket in the EU jurisdiction holds bytes ([environments](environments.md) maps backends to buckets).

- Metadata and bytes target the same environment.
- `documents.storage_bucket` keeps the logical label `organization-documents`, not the bucket name.
- The server authorizes a transfer and signs a short-lived URL; the browser moves the bytes. Server-generated files (artifact exports, handover packages, payroll exports) are the one exception: the server writes them with `putStorageObject`.
- `lib/documents/storage-path.ts` builds an upload's path, `{organizationId}/{documentId}/{sanitizedFileName}`, or for a new version `{organizationId}/{documentId}/versions/{uploadId}/{versionNumber}-…` with a fresh id per version ticket. Finalize registers a copy beside it whose file name starts with a fresh id per attempt. A registered path never changes; rename and move update metadata only.
- `lib/storage/r2.ts` refuses a key outside the given organization, and a copy, put, delete or list whose keys do not share one organization prefix.
- A view URL renders inline only for MIME types safe to render; every other type downloads. The viewer fetches a new URL each time it opens.

## Upload flow

1. `createDocumentUploadTicket` authorizes user, organization, target and folder, and returns a signed PUT URL with the content type pinned. The URL writes a staging key (`<organization>/staging/...`), never the document's key.
2. The browser PUTs the bytes to R2.
3. `finalizeDocumentUpload` authorizes again, recomputes the path on the server, and copies the staging object to a key of its own beside it (`promoteUploadedObject`). A HEAD request checks the copy's size and content type. One database function inserts metadata, link and audit events with that key.

- Only the server writes a key a row references, and only the finalize attempt that registers it. A still-valid signed URL reaches only the staging key after finalize, and a second finalize of the same upload copies to another key, so the bytes of a registered file never change.
- A new version's finalize recomputes its path from the ticket's upload id. When a version with the ticket's number is already saved, the finalize answers `already_finalized` only when the caller saved it from that upload's folder (`isOwnSavedVersion`), so a retry whose answer got lost reports its own save as saved, also after a filing or a category change. A version another upload saved, of another person or of the same person, stays a `version_conflict`, even with the same number and file name.
- A finalize whose registration the database refused deletes its own copy. After an unknown outcome, such as a transport failure, the copy stays, since the registration may still commit. A finalize refused before the copy deletes the staging object.
- `DOCUMENT_MAX_FILE_SIZE_BYTES` applies at the ticket and again to the copy.
- Protected personnel uploads (`createPersonnelDocumentUploadTicket`, `finalizePersonnelDocumentUpload`) follow the same steps. A signed cleanup capability binds actor, organization, owner, document, file name, class and operation. The cleanup removes only the staging object, so it never removes a registered copy. A replay of a registered upload touches no storage.
- An `Arbeitsnachweis` export stores each attempt's HTML under a key of its own. An export the database refused, or answered as a duplicate of a committed export, deletes only its own object; after an unknown outcome the object stays.
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
| `/dokumente` library, folders, trash | Yes | No; the route redirects |
| Upload on a job page | Yes | Only on an assigned job |
| Upload on a project, customer or employee page | Yes | No |
| View or download the current version | Yes | Only when linked to an assigned job, or to a project with an assigned job |
| Earlier versions and audit history | Yes | No |
| Rename, move, copy, delete, link, unlink, reclassify, new version | Yes | No |
| Document date, retention class, filing, and seeing them | Yes | No |

- Field access follows assigned work: `lib/documents/access.ts` decides it, and `app_private.can_access_document` holds the same rule for Realtime. A customer or employee link alone grants nothing.
- A field worker's document carries only the links `readableDocumentLinks` keeps: an assigned job, that job's project or customer, and the worker. `hydrateDocuments` takes the caller's context, so no reader resolves another link's names for them.
- The version and audit history of an ordinary document stays with managers: both history actions authorize through `getDocumentWithHistory`, and the `document_versions` and `document_audit_events` policies give an assignment no ordinary row. A protected personnel document keeps its own rule below.
- Every project-level write needs a manager, the upload ticket and finalize included. Exporting a project-level `Arbeitsnachweis` is such a write.
- Protected personnel documents: the affected employee reads a version only through an unrevoked release of that version, and can upload requested own health evidence. Admin reads all classes. Büro manages only `personnel_standard` and reads no `admin_restricted` or `health_evidence` bytes, nor restores or permanently deletes such a trashed document (`getDeletedDocumentForManager`, `restore_document`). A release grants reading only: every document write authorizes through `getManageableDocument`, and `lock_active_document` and `finalize_document_version_upload` refuse a non-Admin on an Admin-only class, so a Büro member's own released file of that class stays read-only to them. Assignment, planning, document access and approval responsibility never widen this. Operational consumers get a status, never bytes.

## Operations

- Move changes metadata only. A folder never moves or copies into itself or its descendants.
- Copy creates new rows and copies each object server-side, without links, with the prefix `Kopie von ` and collision-safe naming.
- Delete is soft; storage keeps the bytes. Restore keeps the folder if it still exists, otherwise uses the root. Permanent delete removes every object and the row, unless [retention](#retention-and-filing) refuses it.
- Versioning applies to `contract`, `invoice`, `offer` and `report`. No rollback.
- Every mutation writes rows and audit events in one database function call. Storage is not transactional: write an object before the call and discard it on refusal; delete an object only after its row is gone.
- `/dokumente?document=<document-id>` opens that document. Other features link to the library record, never a copy.
- Document readers carry no cache tag. A mutation revalidates its routes with `revalidatePath`.

## Retention and filing

The owner's schedule (werk-flow/werkflow-planning#24) has one class: ten years for financial papers. The retention end is 31 December of the document date's year plus ten years; from the next day the period no longer blocks permanent deletion.

- An ordinary upload of an invoice, offer or contract gets the class. A copy, a generated report and a protected personnel document do not. The document date (`Belegdatum`) defaults to the Berlin day of the upload.
- Admin and Büro change the document date and the class, each change with its audit event, until they file the document. The details form, the action and `update_document_retention` each refuse a date outside `documentDateRange` (`lib/documents/retention.ts`) with `document_date_out_of_range`. A protected personnel document keeps its own rules: no class, no filing.
- Filing (`Festschreiben`) is final and audited. `lib/documents/filing.ts` is the server-only path: a server that generates an original, such as an invoice, files it right after its registration. A filed document refuses a new version, any byte replacement and the trash. Rename, move, category label and links stay possible and audited.
- A filed document names its filer (`filed_by`) for as long as it exists. As with the uploader, that person cannot delete their account while the document remains.
- `lib/documents/retention.ts` owns the deletion rule the feature spec states, for the actions and the library; `get_organization_deletion_scope` and `delete_organization` apply it to organization deletion. The trigger `documents_retention_guard` repeats every refusal under each database write, and lets organization teardown pass only once the organization row is gone.
- Only Admin and Büro receive a document's archive data (`hydrateDocuments`).

## Storage cleanup

Deleting an organization lists every object under its prefix, deletes its rows, and only then deletes the listed objects, so a refusal in the database keeps every file. A failed object deletion after the rows went is logged and leaves orphaned objects. Apart from that, no feature reports or deletes orphaned objects (a staging object whose finalize never ran). When reconciliation becomes a need, build an admin maintenance page with a reviewed authorization boundary and follow the [recovery runbook](recovery-and-incidents.md#restore-procedure-database): list candidates, never purge by prefix, keep objects for review.
