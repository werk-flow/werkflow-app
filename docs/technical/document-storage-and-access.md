# Document storage and access

Status: living — last reviewed 2026-10-05

This page holds the rules for document bytes, storage paths, signed URLs, access, links, trash and versions. The feature spec [document-management.md](../features/document-management.md) owns what users can do, the planned scope and the open decisions. `lib/supabase/database.types.ts` and live Supabase inspection show the schema.

## Where bytes and metadata live

Postgres holds the metadata: folders, documents, links, categories, trash state, versions and audit events. A private Cloudflare R2 bucket in the EU jurisdiction holds the bytes. [Decision 0001](../decisions/0001-infrastructure-stack.md) owns the provider choice. [Environments](environments.md) owns the mapping of backends to buckets, the credentials and the bucket CORS setup.

- Metadata and bytes must target the same environment.
- `documents.storage_bucket` keeps the logical label `organization-documents`. It is not the physical bucket name.
- The server never streams file bytes for a browser transfer. The server authorizes the transfer and signs a URL. The browser sends or reads the bytes directly. No file bytes pass through a Server Action.
- Server-generated files (work-artifact exports, handover packages, payroll exports) are the exception. The server writes those bytes with `putStorageObject`.

### Storage paths

A document path is `{organizationId}/{documentId}/{sanitizedFileName}`. A version path is `{organizationId}/{documentId}/versions/{versionNumber}-{sanitizedFileName}`. `lib/documents/storage-path.ts` builds both.

A storage path never changes. A rename or a folder move updates metadata only. This keeps rename and move cheap and avoids broken links, races and storage copies. The cost is that a display name can differ from the stored file name.

Every storage key starts with the id of the owning organization. `lib/storage/r2.ts` checks the key on every operation: `assertOrganizationStorageKey` makes the signers refuse a key outside the given organization, and copy, put, delete and list refuse a call whose keys do not share one organization prefix. `lib/storage/r2.test.ts` proves the refusals. [Security](security.md) owns the invariant.

### Signed URLs

All access uses short-lived signed URLs. A view URL renders inline only for the MIME types that are safe to render. Every other type downloads as an attachment. A download URL carries the file name. An issued URL stays usable until it expires, so the viewer fetches a new URL when it opens again.

## Upload flow

An upload has three steps:

1. `createDocumentUploadTicket` authorizes the user, the organization, the target and the folder. It returns a document id and a signed PUT URL with the content type pinned into the signature.
2. The browser PUTs the bytes directly to R2.
3. `finalizeDocumentUpload` authorizes again and recomputes the storage path on the server, so a client can never register a foreign key. It verifies the existence and the size of the object with a HEAD request and takes the content type from the object. Then one database function inserts the metadata, the link and the audit events in one transaction.

A finalize that fails after the object exists deletes the object, unless a concurrent finalize of the same upload committed it first. The size limit `DOCUMENT_MAX_FILE_SIZE_BYTES` applies at ticket creation and again to the actual object size at finalize. A version upload follows the same flow and adds a version-number conflict check.

Variants of the flow:

- A protected personnel upload uses `createPersonnelDocumentUploadTicket` and `finalizePersonnelDocumentUpload` with the same signed PUT, HEAD verification and path pattern. A signed cleanup capability binds the actor, organization, personnel owner, document, file name, class and operation. A failed finalize can therefore remove only its own orphan.
- A handover release renders a deterministic customer-safe HTML file on the server and writes it to the organization's path. A guarded database RPC then registers the document, the release facts and the lifecycle transition. The release references source documents by exact identity and copies no source bytes. A failed registration deletes the object only after it proves that no committed document or release references the object.

## Links and ownership

A document exists once. A link is a relation, not a second file. Each `document_links` row points to exactly one target, and a check constraint enforces that. A document can have several links. A link never moves a storage object and never changes the folder.

An upload from a context page creates the document and its link. The file then appears in that context and in the central library.

Rules per link target:

- A request upload links to the request. Conversion adds a second link to the created job or project and copies nothing. Request-linked documents are manager-only.
- A work-template evidence expectation is metadata. Applying a template creates no file, folder, link, approval or signature.
- A document becomes evidence for a work-artifact revision only through an explicit relation to that exact revision. An ordinary upload never becomes evidence automatically. Removing an evidence fulfilment needs an attributable reason.
- A handover release freezes the document id, version number and storage path of each selected source. An old package document stays addressable after a withdrawal and a successor release.
- A link to installed equipment, a service case or a maintenance coverage grants an employee no document access. The employee still reaches only documents linked to the exact assigned job.
- When an equipment-history or service-case event depends on a link, an ordinary unlink is rejected. Permanent deletion of the document is rejected while equipment history depends on one of its links. Immutable history cannot lose its reference. Organization teardown is the one guarded exception.
- A protected personnel file is one `documents` row plus `personnel_documents` metadata keyed to the personnel record. It carries no ordinary link and no folder, and the ordinary library excludes it. Because the owner is the personnel record, a future starter without a login can own documents.

### No automatic folders

Creating a job, project, customer or employee creates no folder. Office staff build manual folders. The library also offers link filters, category filters, search and the `Verknüpfungen` overview, which groups linked documents without folders.

The reasons: entity names change and automatic folders go stale, physical folders complicate documents with several links, and office staff want their own taxonomy. Logical views per Auftrag, Projekt, Kunde or Mitarbeiter are the preferred direction. Consider physical storage folders only for a hard operational need. Before automatic folders or AI extraction arrive, update the feature spec with the decided UX.

## Access

Two layers enforce authorization: the server actions in `lib/documents/actions.ts` and Postgres RLS through `app_private` helpers. When you change a permission, change both layers.

Ordinary documents:

| Action | `admin` and `buero` | `employee` |
| --- | --- | --- |
| Use the `/dokumente` library, folders, trash, audit history and versions | Yes | No. The route redirects. |
| Upload on a job page | Yes | Only on an assigned job |
| Upload on a project, customer or employee page | Yes | No |
| View or download a document | Yes | Only when the document is linked to an assigned job, or to a project with an assigned job |
| Rename, move, copy, delete, link, unlink, reclassify, upload a version | Yes | No |

A field employee reads an ordinary document only through assigned work: the document has a link to a job that the employee is assigned to, or a link to a project that has such a job. `ensureProjectWorkAccess` and `getAuthorizedDocument` in `lib/documents/access.ts` decide it, the same rule as the project page itself. In the database `app_private.can_access_document` holds the same rule, so Realtime delivers a project document's changes to that employee; `sql:work-execution` checks it. A link to a customer or employee alone grants no field access. Field access follows assigned work, not organization-wide visibility. The employee reaches job documents from the job work pack, which exposes view, download and upload only, and project documents from the project page, read-only. Every project-level write, including the upload ticket and its finalize step, requires a manager: `authorizeDocumentUploadTarget` checks a project target with `ensureProjectManagerAccess`. The export of a project-level `Arbeitsnachweis` is such a write too: `exportWorkArtifact` refuses it for a field worker before it stores anything, `export_work_artifact` and `finalize_work_artifact_export` refuse it in the database, `lib/work-artifacts/export-access.test.ts` drives the action and `supabase/tests/document_writes.sql` the functions. `lib/documents/project-document-access.test.ts` drives the project reads, the signed URLs and the refused project writes.

Protected personnel documents use a separate path:

- The affected employee reads a current version only through an unrevoked release of that exact version. The employee can also upload requested own health evidence through the onboarding page.
- Admin reads all protected classes. Büro manages only `personnel_standard` and cannot read `admin_restricted` or `health_evidence` bytes.
- Job assignment, planning authority, ordinary document access and scoped approval responsibility never widen this access.
- Operational consumers receive a status, never bytes.

## Operations

- Move changes metadata only. The server and the UI both block moving or copying a folder into itself or its descendants.
- Copy creates new document rows and copies each R2 object server-side. Copy does not copy links. A copied name gets the prefix `Kopie von ` and passes collision-safe naming in the target folder.
- Delete is a soft delete. Storage keeps the bytes. Deleting a folder soft-deletes its documents and records audit events.
- Restore keeps the folder when that folder still exists. Otherwise the document moves to the library root, and the server resolves name collisions there.
- Permanent delete removes the current object, every version object and the document row.
- Versioning applies to the categories `contract`, `invoice`, `offer` and `report`. A new version keeps the old metadata in `document_versions` and updates the current pointer. Users download earlier versions through a signed URL. No rollback exists.
- A category is an organizational label that the upload infers from file name and MIME type. Managers can reclassify. No structured invoice or contract schema exists.
- Every document mutation writes its rows and its audit events through one database function call, so a refused step changes nothing; `supabase/tests/document_writes.sql` proves it per function. Storage is not transactional: an action writes an object before the call and discards it when the call refuses, and deletes an object only after the row is gone. A link change saves every added and removed link or none. Managers see the history in the details dialog. The field-worker pages do not show it.
- A link to `/dokumente?document=<document-id>` opens that exact document in the viewer for an authorized user. Source links from other features point at the library record instead of a copy.

## Storage cleanup

The app has no storage reconciliation feature, and no Server Action reports or deletes orphaned objects. An orphaned upload is an object whose PUT succeeded and whose finalize never ran. Users cannot see it. An interrupted protected personnel upload whose browser never returns also leaves an orphan.

When reconciliation becomes a product need, build it as an admin maintenance page with a reviewed authorization boundary. Follow the orphan rules in the [recovery runbook](recovery-and-incidents.md#restore-procedure-database): list candidates, never purge by prefix, and preserve objects for review.

Retention-relevant categories will also get copies in an independent immutable archive. The feature spec owns the product direction and decision 0001 owns the infrastructure decision.

## Freshness

Document readers carry no cache tag. A document mutation revalidates the affected routes with `revalidatePath`, and Realtime refreshes other sessions. [realtime-and-caching.md](realtime-and-caching.md) owns the cache, Realtime and freshness rules.
