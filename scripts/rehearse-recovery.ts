import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';
import { buildDocumentStoragePath } from '../lib/documents/storage-path';
import {
  DOCUMENT_PATHS_SQL,
  assertFilesReconciled,
  assertLocalDockerEndpoint,
  changedAccess,
  dumpDigest,
  cleanupRecoveryResources,
  assertLocalRecoveryEndpoint,
  assertRecoveryResource,
  createRecoveryTarget,
  objectIdentity,
  parseAccessSnapshot,
  parseDocumentPaths,
  planRepresentativeOrganization,
  reconcileDocumentPaths,
  restoreObjects,
  runRecoveryStages,
  type AccessSnapshot,
  type FileReconciliation,
  type RecoveryResource,
  type RehearsalObject,
  type StoredObject,
} from '../lib/testing/runs/recovery-rehearsal';
import { withWorkspaceTestLock } from '../lib/testing/runner/workspace-test-lock';
import { withTestSession } from '../lib/testing/local-stack/test-session';

// Deliberately has no target/env override or restore-file argument. It can only
// create a new pair of databases and private local Storage buckets, fill them
// with a made-up organization, and remove exactly what it created.
const databaseContainer = 'supabase_db_werkflow-app';
let sessionSignal: AbortSignal | undefined;
let dockerContext: string | undefined;
const target = createRecoveryTarget();
const resources: RecoveryResource[] = [];
const events: { stage: string; status: string; durationMs?: number }[] = [];
let files: (FileReconciliation & { paths: number; objects: number }) | undefined;
const directory = resolve('.agent-logs/recovery', target.runId);
const sourceHashes = Object.fromEntries(
  ['scripts/rehearse-recovery.ts', 'lib/testing/runs/recovery-rehearsal.ts'].map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
// The journal holds stage names, durations, counts and ids; never a path, a row or bytes.
const journal = (): void => {
  writeFileSync(
    resolve(directory, 'journal.json'),
    JSON.stringify({ version: 2, target, sourceHashes, resources, events, files }, null, 2),
  );
};
function record(stage: string, status: string, durationMs?: number): void {
  events.push(durationMs === undefined ? { stage, status } : { stage, status, durationMs });
  journal();
}

async function command(arguments_: string[], input?: string): Promise<string> {
  sessionSignal?.throwIfAborted();
  const localArguments =
    arguments_[0] === 'docker' && dockerContext
      ? ['docker', '--context', dockerContext, ...arguments_.slice(1)]
      : arguments_;
  const child = Bun.spawn(localArguments, {
    ...(sessionSignal ? { signal: sessionSignal } : {}),
    stdin: input === undefined ? 'ignore' : new Blob([input]),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, DOCKER_HOST: '', DOCKER_CONTEXT: dockerContext ?? '' },
    timeout: 120_000,
  });
  const [output] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if ((await child.exited) !== 0) throw new Error('Local recovery command failed.');
  return output.trim();
}

/**
 * `postgres` runs as a client would against the API: owner rights, no
 * superuser. `supabase_admin` dumps and loads, as the provider's backup and
 * restore do, because the auth, storage and vault schemas belong to it.
 */
async function sql(
  database: string,
  query: string,
  user: 'postgres' | 'supabase_admin' = 'postgres',
): Promise<string> {
  if (database !== 'postgres' || user !== 'postgres') assertRecoveryResource(target, database);
  return command(
    [
      'docker',
      'exec',
      '-i',
      databaseContainer,
      'psql',
      '-X',
      '-U',
      user,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-A',
      '-t',
      '-q',
    ],
    query,
  );
}

async function dump(database: string, ...options: string[]): Promise<string> {
  if (database !== 'postgres' || !options.includes('--schema-only')) assertRecoveryResource(target, database);
  return command([
    'docker',
    'exec',
    databaseContainer,
    'pg_dump',
    '-U',
    'supabase_admin',
    ...options,
    '--dbname',
    database,
  ]);
}

function localCredentials(): { accessKeyId: string; secretAccessKey: string; serviceKey: string } {
  const entries = new Map<string, string>();
  for (const line of readFileSync('.env.local-stack-backup', 'utf8').split(/\r?\n/)) {
    const [, key, rawValue] = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line) ?? [];
    if (key !== undefined && rawValue !== undefined) entries.set(key, rawValue.replace(/^["']|["']$/g, ''));
  }
  const accessKeyId = entries.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = entries.get('R2_SECRET_ACCESS_KEY');
  const serviceKey = entries.get('SUPABASE_SECRET_KEY') ?? entries.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!accessKeyId || !secretAccessKey || !serviceKey)
    throw new Error('Local stack backup lacks Storage credentials.');
  return { accessKeyId, secretAccessKey, serviceKey };
}

/** The revision's migrations, as `supabase_migrations.schema_migrations` records them. */
function revisionMigrations(): { version: string; name: string }[] {
  return readdirSync('supabase/migrations')
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const [, version, name] = /^(\d{14})_(.+)\.sql$/.exec(file) ?? [];
      if (!version || !name) throw new Error('Unexpected migration file name.');
      return { version, name };
    });
}

const hash = (content: string): string => createHash('sha256').update(content).digest('hex');

async function main(): Promise<void> {
  if (process.argv.length !== 2)
    throw new Error('This rehearsal accepts no arguments or external backup inputs.');
  await withWorkspaceTestLock({ operation: 'isolated recovery rehearsal' }, async () => {
    await withTestSession(async (signal) => {
      sessionSignal = signal;
      // Docker must answer on this machine's own socket; never a remote context.
      const [contextName, dockerEndpoint] = (
        await command(['docker', 'context', 'inspect', '--format', '{{.Name}} {{.Endpoints.docker.Host}}'])
      ).split(' ');
      if (!contextName || !/^[A-Za-z0-9_.-]+$/.test(contextName) || !dockerEndpoint)
        throw new Error('Recovery requires local Docker.');
      assertLocalDockerEndpoint(dockerEndpoint, homedir());
      dockerContext = contextName;
      const label = await command([
        'docker',
        'inspect',
        databaseContainer,
        '--format',
        '{{index .Config.Labels "com.supabase.cli.project"}}',
      ]);
      if (label !== 'werkflow-app') throw new Error('Unexpected local database container identity.');
      let healthy = false;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const health = await command([
          'docker',
          'inspect',
          databaseContainer,
          'supabase_storage_werkflow-app',
          'supabase_kong_werkflow-app',
          '--format',
          '{{.State.Health.Status}}',
        ]);
        if (health.split(/\r?\n/).every((status) => status === 'healthy')) {
          healthy = true;
          break;
        }
        await Bun.sleep(2_000);
      }
      if (!healthy) throw new Error('Local recovery services did not become healthy.');
      const localHost = '127.0.0.1';
      const endpoint = `http://${localHost}:54321/storage/v1/s3`;
      assertLocalRecoveryEndpoint(endpoint, localHost);
      const credentials = localCredentials();
      const storage = createClient(`http://${localHost}:54321`, credentials.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: Object.assign(
            (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
              fetch(input, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' }),
            { preconnect: fetch.preconnect },
          ),
        },
      }).storage;
      const objectStore = new S3Client({
        endpoint,
        region: 'auto',
        forcePathStyle: true,
        credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
        maxAttempts: 1,
        requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
      });
      mkdirSync(directory, { recursive: true });
      journal();

      const organization = planRepresentativeOrganization();
      // An upload that lands after the daily backup: its object survives, its row does not.
      const lateDocumentId = randomUUID();
      const lateUpload: RehearsalObject = {
        documentId: lateDocumentId,
        path: buildDocumentStoragePath({
          organizationId: organization.organizationId,
          documentId: lateDocumentId,
          fileName: 'nach-der-sicherung.pdf',
        }),
        content: 'WerkFlow recovery rehearsal upload after the backup.\n',
      };
      const everyObject = [...organization.objects, lateUpload];
      const migrations = revisionMigrations();

      async function createDatabase(name: string): Promise<void> {
        assertRecoveryResource(target, name);
        if ((await sql('postgres', `select count(*) from pg_database where datname='${name}'`)) !== '0')
          throw new Error('Database already exists.');
        const entry: RecoveryResource = { kind: 'database', name, state: 'planned' };
        resources.push(entry);
        journal();
        await sql('postgres', `create database ${name} template template0;`);
        entry.state = 'created';
        journal();
      }
      async function createBucket(name: string): Promise<void> {
        assertRecoveryResource(target, name);
        const existing = await storage.getBucket(name);
        if (!existing.error) throw new Error('Bucket already exists.');
        if (!('statusCode' in existing.error) || String(existing.error.statusCode) !== '404')
          throw new Error('Bucket ownership check failed.');
        const entry: RecoveryResource = { kind: 'bucket', name, state: 'planned' };
        resources.push(entry);
        journal();
        const result = await storage.createBucket(name, { public: false });
        if (result.error) {
          const status = 'statusCode' in result.error ? String(result.error.statusCode) : 'unavailable';
          record('bucket-create-http-status', /^\d{3}$/.test(status) ? status : 'unavailable');
          throw new Error('Private local recovery bucket creation failed.');
        }
        entry.state = 'created';
        journal();
      }
      async function put(bucket: string, key: string, content: string): Promise<void> {
        assertRecoveryResource(target, bucket);
        await objectStore.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: 'text/plain' }),
        );
      }
      async function get(bucket: string, key: string): Promise<string> {
        assertRecoveryResource(target, bucket);
        const result = await objectStore.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const content = await result.Body?.transformToString();
        if (content === undefined) throw new Error('Recovered object has no content.');
        return content;
      }
      async function list(bucket: string): Promise<StoredObject[]> {
        assertRecoveryResource(target, bucket);
        const stored: StoredObject[] = [];
        let continuationToken: string | undefined;
        do {
          const page = await objectStore.send(
            new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
          );
          for (const entry of page.Contents ?? []) {
            if (entry.Key === undefined || entry.Size === undefined)
              throw new Error('Unreadable object listing.');
            stored.push({ key: entry.Key, sizeBytes: entry.Size });
          }
          continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (continuationToken);
        return stored;
      }
      // Deletes only the keys this run wrote, one by one; never a listing or prefix.
      async function removeObjects(bucket: string): Promise<void> {
        assertRecoveryResource(target, bucket);
        for (const object of everyObject)
          await objectStore.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.path }));
      }
      async function reconcile(): Promise<FileReconciliation & { paths: number; objects: number }> {
        const paths = parseDocumentPaths(await sql(target.restoredDatabase, DOCUMENT_PATHS_SQL));
        const stored = await list(target.restoredBucket);
        return { ...reconcileDocumentPaths(paths, stored), paths: paths.length, objects: stored.length };
      }

      // Each reader's visible ids per table, read through the restored grants and RLS.
      let readableTables: string | undefined;
      async function accessSnapshot(database: string, userId: string): Promise<AccessSnapshot> {
        readableTables ??= await sql(
          database,
          `select string_agg(format('select %L||''|''||count(*)||'':''||coalesce(md5(string_agg(id::text, '','' order by id::text)), '''') from public.%I', c.relname, c.relname), ' union all ' order by c.relname)
           from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
             and has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT');`,
        );
        if (!readableTables) throw new Error('No client-readable table found.');
        return parseAccessSnapshot(
          await sql(
            database,
            `set role authenticated;
             select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false) \\g /dev/null
             ${readableTables};`,
          ),
        );
      }
      async function visibleDocuments(
        database: string,
        userId: string,
        documentIds: readonly string[],
      ): Promise<number> {
        return Number(
          await sql(
            database,
            `set role authenticated;
             select set_config('request.jwt.claims', json_build_object('sub', '${userId}', 'role', 'authenticated')::text, false) \\g /dev/null
             select count(*) from public.documents where id = any(array[${documentIds.map((id) => `'${id}'`).join(',')}]::uuid[]);`,
          ),
        );
      }
      // The boundary the issue names, checked absolutely on both sides of the restore.
      const ownDocumentIds = organization.objects
        .filter((object) => object.path.startsWith(`${organization.organizationId}/`))
        .map((object) => object.documentId);
      async function assertBoundaries(database: string): Promise<void> {
        const { readers, jobDocumentIds, protectedDocumentIds } = organization;
        if ((await visibleDocuments(database, readers.outsider, ownDocumentIds)) !== 0)
          throw new Error('A member of another organization reads its documents.');
        if (
          (await visibleDocuments(database, readers.unassignedEmployee, [
            ...jobDocumentIds,
            ...protectedDocumentIds,
          ])) !== 0
        )
          throw new Error('An employee without assignment reads job or protected documents.');
        if ((await visibleDocuments(database, readers.assignedEmployee, protectedDocumentIds)) !== 0)
          throw new Error('An employee reads protected personnel documents.');
        if ((await visibleDocuments(database, readers.assignedEmployee, jobDocumentIds)) === 0)
          throw new Error('An assigned employee lost the documents of their job.');
      }
      // Row counts per table across the app's and the provider's schemas.
      async function rowCounts(database: string): Promise<string> {
        const counting = await sql(
          database,
          `select string_agg(format('select %L||''=''||count(*) from %I.%I', n.nspname||'.'||c.relname, n.nspname, c.relname), ' union all ' order by n.nspname, c.relname)
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname in ('public', 'auth', 'storage', 'supabase_migrations') and c.relkind in ('r', 'p');`,
          'supabase_admin',
        );
        // A union has no order of its own.
        return hash((await sql(database, `${counting};`, 'supabase_admin')).split('\n').sort().join('\n'));
      }

      let databaseBackup: string | undefined;
      let schemaDigest: string | undefined;
      let rowDigest: string | undefined;
      const accessBefore = new Map<string, AccessSnapshot>();
      await runRecoveryStages(
        {
          seed: async () => {
            await createDatabase(target.sourceDatabase);
            await createDatabase(target.restoredDatabase);
            for (const bucket of [target.sourceBucket, target.backupBucket, target.restoredBucket])
              await createBucket(bucket);
            // The full migrated schema comes from the stack, schema only: never a row
            // of it. Every migration of this revision must be applied there.
            const applied = new Set(
              (await sql('postgres', 'select version from supabase_migrations.schema_migrations;')).split(
                /\r?\n/,
              ),
            );
            if (migrations.some((migration) => !applied.has(migration.version)))
              throw new Error('The local stack lacks a migration of this revision.');
            record(
              'schema-stack-migrations',
              applied.size === migrations.length ? 'match-revision' : 'include-unmerged',
            );
            // pg_cron runs only in the cluster's `postgres` database. Its empty schema
            // keeps the provider's default privileges for it loadable.
            const schema = await dump('postgres', '--schema-only', '--exclude-extension=pg_cron');
            await sql(target.sourceDatabase, 'create schema cron;', 'supabase_admin');
            await sql(target.sourceDatabase, schema, 'supabase_admin');
            await sql(
              target.sourceDatabase,
              `insert into supabase_migrations.schema_migrations (version, name) values ${migrations
                .map((migration) => `('${migration.version}', '${migration.name}')`)
                .join(',')};`,
              'supabase_admin',
            );
            await sql(target.sourceDatabase, organization.seedSql);
            for (const object of organization.objects)
              await put(target.sourceBucket, object.path, object.content);
            record('seed-representative-organization', `${organization.objects.length}-objects`);
          },
          backup: async () => {
            await assertBoundaries(target.sourceDatabase);
            for (const userId of Object.values(organization.readers))
              accessBefore.set(userId, await accessSnapshot(target.sourceDatabase, userId));
            schemaDigest = dumpDigest(await dump(target.sourceDatabase, '--schema-only'));
            rowDigest = await rowCounts(target.sourceDatabase);
            // The provider's daily backup: one logical dump of the whole database,
            // owners and grants included, taken by the superuser.
            databaseBackup = await dump(target.sourceDatabase, '--format=plain');
            if (!databaseBackup.includes('CREATE TABLE public.document_versions'))
              throw new Error('Empty database backup.');
            await put(target.sourceBucket, lateUpload.path, lateUpload.content);
            // The object store outlives the database: copy what it holds now.
            for (const object of everyObject) {
              const content = await get(target.sourceBucket, object.path);
              if (hash(content) !== hash(object.content)) throw new Error('Source content mismatch.');
              await put(target.backupBucket, object.path, content);
            }
          },
          'remove-source': async () => {
            await sql('postgres', `drop database ${target.sourceDatabase};`);
            if (
              (await sql(
                'postgres',
                `select count(*) from pg_database where datname='${target.sourceDatabase}'`,
              )) !== '0'
            )
              throw new Error('Source loss not established.');
            await removeObjects(target.sourceBucket);
            for (const object of everyObject) {
              try {
                await objectStore.send(
                  new HeadObjectCommand({ Bucket: target.sourceBucket, Key: object.path }),
                );
                throw new Error('Source object still exists.');
              } catch (error) {
                if (!(error instanceof Error) || error.name !== 'NotFound') throw error;
              }
            }
          },
          restore: async () => {
            if (!databaseBackup) throw new Error('Missing completed database backup.');
            await command(
              [
                'docker',
                'exec',
                '-i',
                databaseContainer,
                'psql',
                '-X',
                '-U',
                'supabase_admin',
                '-d',
                target.restoredDatabase,
                '-v',
                'ON_ERROR_STOP=1',
                '--single-transaction',
                '-q',
              ],
              databaseBackup,
            );
            await restoreObjects(
              everyObject,
              async (path) => {
                try {
                  return await get(target.backupBucket, path);
                } catch (error) {
                  if (error instanceof Error && error.name === 'NoSuchKey') return undefined;
                  throw error;
                }
              },
              (path, content) => put(target.restoredBucket, path, content),
            );
          },
          verify: async () => {
            const restoredMigrations = await sql(
              target.restoredDatabase,
              "select string_agg(version, ',' order by version) from supabase_migrations.schema_migrations;",
            );
            if (restoredMigrations !== migrations.map((migration) => migration.version).join(','))
              throw new Error('Restored migration history differs from the revision.');
            if (dumpDigest(await dump(target.restoredDatabase, '--schema-only')) !== schemaDigest)
              throw new Error('Restored schema differs from the backed-up schema.');
            if ((await rowCounts(target.restoredDatabase)) !== rowDigest)
              throw new Error('Restored row counts differ.');
            record('verify-migration-history-schema-and-row-counts', 'passed');

            files = await reconcile();
            journal();
            assertFilesReconciled(files, [objectIdentity(lateUpload.path)]);
            for (const object of organization.objects)
              if ((await get(target.restoredBucket, object.path)) !== object.content)
                throw new Error(`Restored bytes differ for document ${object.documentId}.`);
            record('verify-every-document-path-and-bytes-orphan-kept', 'passed');

            // Negative control: a removed object fails reconciliation and names its document.
            const removed = organization.objects.find((object) =>
              organization.jobDocumentIds.includes(object.documentId),
            );
            if (!removed) throw new Error('No job document to remove.');
            await objectStore.send(
              new DeleteObjectCommand({ Bucket: target.restoredBucket, Key: removed.path }),
            );
            const withoutObject = await reconcile();
            if (withoutObject.missingDocumentIds.join(',') !== removed.documentId)
              throw new Error('A removed object went unnoticed.');
            await put(target.restoredBucket, removed.path, await get(target.backupBucket, removed.path));
            assertFilesReconciled(await reconcile(), [objectIdentity(lateUpload.path)]);
            record('verify-removed-object-names-its-document', 'passed');

            await assertBoundaries(target.restoredDatabase);
            for (const [userId, before] of accessBefore) {
              if (changedAccess(before, await accessSnapshot(target.restoredDatabase, userId)).length > 0)
                throw new Error('A reader sees other rows after the restore.');
            }
            record('verify-outsider-and-unassigned-employee-read-as-before', 'passed');

            const first = organization.objects[0];
            if (!first) throw new Error('No restored object.');
            const signed = await getSignedUrl(
              objectStore,
              new GetObjectCommand({ Bucket: target.restoredBucket, Key: first.path }),
              { expiresIn: 60 },
            );
            const download = await fetch(signed, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
            if (!download.ok || (await download.text()) !== first.content)
              throw new Error('Restored signed capability failed.');
            const unsigned = new URL(signed);
            unsigned.search = '';
            const denied = await fetch(unsigned, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
            if (![401, 403].includes(denied.status))
              throw new Error('Unsigned object access was not denied.');
            const tampered = new URL(signed);
            tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64));
            const tamperedResponse = await fetch(tampered, {
              redirect: 'error',
              signal: AbortSignal.timeout(10_000),
            });
            if (![401, 403].includes(tamperedResponse.status))
              throw new Error('Tampered capability was not denied.');
            record('verify-signed-access-unsigned-and-tampered-denial', 'passed');
          },
          cleanup: async () => {
            try {
              await cleanupRecoveryResources(
                target,
                resources,
                async (resource) => {
                  if (resource.kind === 'bucket') {
                    const existing = await storage.getBucket(resource.name);
                    if (existing.error) {
                      if ('statusCode' in existing.error && String(existing.error.statusCode) === '404')
                        return;
                      throw new Error('Bucket cleanup lookup failed.');
                    }
                    await removeObjects(resource.name);
                    const deleted = await storage.deleteBucket(resource.name);
                    if (deleted.error) throw new Error('Bucket cleanup failed.');
                  } else {
                    await sql('postgres', `drop database if exists ${resource.name};`);
                    if (
                      (await sql(
                        'postgres',
                        `select count(*) from pg_database where datname='${resource.name}'`,
                      )) !== '0'
                    )
                      throw new Error('Database cleanup incomplete.');
                  }
                },
                journal,
              );
            } finally {
              objectStore.destroy();
              databaseBackup = undefined;
            }
          },
        },
        record,
      );
      record('acceptance', 'passed');
      console.log(
        `Recovery rehearsal passed; redacted evidence: .agent-logs/recovery/${target.runId}/journal.json`,
      );
    });
  });
}

if (import.meta.main)
  main().catch(() => {
    console.error(
      `Recovery rehearsal failed; no acceptance. Inspect .agent-logs/recovery/${target.runId}/journal.json if created. Provider errors, credentials and signed URLs are deliberately suppressed.`,
    );
    process.exitCode = 1;
  });
