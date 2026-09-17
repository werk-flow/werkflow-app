import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';
import { cleanupRecoveryResources, assertLocalRecoveryEndpoint, assertRecoveryResource, createRecoveryTarget, runRecoveryStages, type RecoveryResource } from '../lib/testing/recovery-rehearsal';
import { withWorkspaceTestLock } from '../lib/testing/workspace-test-lock';
import { withLocalStackLease } from '../lib/testing/local-stack-lease';

// Deliberately has no target/env override or restore-file argument. It can only
// create a new synthetic pair of databases and private local Storage buckets.
const databaseContainer = 'supabase_db_werkflow-app';
let leaseSignal: AbortSignal | undefined;
const target = createRecoveryTarget();
const resources: { kind: 'database' | 'bucket'; name: string; state: 'planned' | 'created' | 'cleaned' }[] = [];
const events: { stage: string; status: string }[] = [];
const directory = resolve('.agent-logs/recovery', target.runId);
const sourceHashes = Object.fromEntries(['scripts/rehearse-recovery.ts', 'lib/testing/recovery-rehearsal.ts']
  .map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const journal = (): void => {
  writeFileSync(resolve(directory, 'journal.json'), JSON.stringify({ version: 1, target, sourceHashes, resources, events }, null, 2));
};
function record(stage: string, status: string): void { events.push({ stage, status }); journal(); }

async function command(arguments_: string[], input?: string): Promise<string> {
  leaseSignal?.throwIfAborted();
  const localArguments = arguments_[0] === 'docker'
    ? ['docker', '--context', 'default', ...arguments_.slice(1)] : arguments_;
  const child = Bun.spawn(process.platform === 'win32' ? ['wsl', ...localArguments] : localArguments, {
    stdin: input === undefined ? 'ignore' : new Blob([input]), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, DOCKER_HOST: '', DOCKER_CONTEXT: 'default' },
    timeout: 60_000,
  });
  const [output] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (await child.exited !== 0) throw new Error('Local recovery command failed.');
  return output.trim();
}

async function sql(database: string, query: string): Promise<string> {
  if (database !== 'postgres') assertRecoveryResource(target, database);
  return command(['docker', 'exec', '-i', databaseContainer, 'psql', '-X', '-U', 'postgres', '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-q'], query);
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
  if (!accessKeyId || !secretAccessKey || !serviceKey) throw new Error('Local stack backup lacks Storage credentials.');
  return { accessKeyId, secretAccessKey, serviceKey };
}

const documents = [
  { id: 1, organization: 'organization-a', key: 'organization-a/document-1/version-1.txt', content: 'Synthetic document version one.\n' },
  { id: 2, organization: 'organization-a', key: 'organization-a/document-1/version-2.txt', content: 'Synthetic document version two.\n' },
  { id: 3, organization: 'organization-b', key: 'organization-b/document-2/version-1.txt', content: 'Synthetic foreign organization document.\n' },
] as const;
const hash = (content: string): string => createHash('sha256').update(content).digest('hex');

async function main(): Promise<void> {
  if (process.argv.length !== 2) throw new Error('This rehearsal accepts no arguments or external backup inputs.');
  await withWorkspaceTestLock({ operation: 'isolated synthetic recovery rehearsal' }, async () => {
    await withLocalStackLease(true, async signal => {
    leaseSignal = signal;
    // Verify Docker uses the local Unix socket; never accept a remote Docker context.
    const dockerEndpoint = await command(['docker', 'context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}']);
    if (dockerEndpoint !== 'unix:///var/run/docker.sock') throw new Error('Recovery requires local Docker.');
    const label = await command(['docker', 'inspect', databaseContainer, '--format', '{{index .Config.Labels "com.supabase.cli.project"}}']);
    if (label !== 'werkflow-app') throw new Error('Unexpected local database container identity.');
    let healthy = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      const health = await command(['docker', 'inspect', databaseContainer, 'supabase_storage_werkflow-app', 'supabase_kong_werkflow-app', '--format', '{{.State.Health.Status}}']);
      if (health.split(/\r?\n/).every(status => status === 'healthy')) { healthy = true; break; }
      await Bun.sleep(2_000);
    }
    if (!healthy) throw new Error('Local recovery services did not become healthy.');
    const localHost = process.platform === 'win32'
      ? (await command(['hostname', '-I'])).split(/\s+/)[0] : '127.0.0.1';
    if (localHost === undefined) throw new Error('Could not resolve the local stack address.');
    const endpoint = `http://${localHost}:54321/storage/v1/s3`;
    assertLocalRecoveryEndpoint(endpoint, localHost);
    const credentials = localCredentials();
    const storage = createClient(`http://${localHost}:54321`, credentials.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' }), { preconnect: fetch.preconnect }) },
    }).storage;
    const objectStore = new S3Client({ endpoint, region: 'auto', forcePathStyle: true,
      credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
      maxAttempts: 1, requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 } });
    mkdirSync(directory, { recursive: true });
    journal();

    async function createDatabase(name: string): Promise<void> {
      assertRecoveryResource(target, name);
      if (await sql('postgres', `select count(*) from pg_database where datname='${name}'`) !== '0') throw new Error('Database already exists.');
      const entry: RecoveryResource = { kind: 'database', name, state: 'planned' };
      resources.push(entry); journal();
      await sql('postgres', `create database ${name} template template0;`);
      entry.state = 'created'; journal();
    }
    async function createBucket(name: string): Promise<void> {
      assertRecoveryResource(target, name);
      const existing = await storage.getBucket(name);
      if (!existing.error) throw new Error('Bucket already exists.');
      if (!('statusCode' in existing.error) || String(existing.error.statusCode) !== '404') throw new Error('Bucket ownership check failed.');
      const entry: RecoveryResource = { kind: 'bucket', name, state: 'planned' };
      resources.push(entry); journal();
      const result = await storage.createBucket(name, { public: false });
      if (result.error) {
        const status = 'statusCode' in result.error ? String(result.error.statusCode) : 'unavailable';
        record('bucket-create-http-status', /^\d{3}$/.test(status) ? status : 'unavailable');
        throw new Error('Private local recovery bucket creation failed.');
      }
      entry.state = 'created'; journal();
    }
    async function put(bucket: string, key: string, content: string): Promise<void> {
      assertRecoveryResource(target, bucket);
      await objectStore.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: content, ContentType: 'text/plain' }));
    }
    async function get(bucket: string, key: string): Promise<string> {
      assertRecoveryResource(target, bucket);
      const result = await objectStore.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const content = await result.Body?.transformToString();
      if (content === undefined) throw new Error('Recovered object has no content.');
      return content;
    }
    async function removeObjects(bucket: string): Promise<void> {
      assertRecoveryResource(target, bucket);
      for (const document of documents) await objectStore.send(new DeleteObjectCommand({ Bucket: bucket, Key: document.key }));
    }
    let databaseBackup: string | undefined;
    await runRecoveryStages({
      seed: async () => {
        await createDatabase(target.sourceDatabase);
        await createDatabase(target.restoredDatabase);
        for (const bucket of [target.sourceBucket, target.backupBucket, target.restoredBucket]) await createBucket(bucket);
        // Purpose-built fixture schema: app-style tenant-scoped document metadata,
        // immutable version paths and private bytes. Never copied from a live DB.
        await sql(target.sourceDatabase, `
          create table organizations(id text primary key);
          create table documents(id integer primary key, organization_id text not null references organizations(id), unique(id,organization_id));
          create table document_versions(id integer primary key, document_id integer not null, organization_id text not null,
            storage_path text not null unique, sha256 text not null, size_bytes integer not null,
            foreign key(document_id,organization_id) references documents(id,organization_id));
          insert into organizations values ('organization-a'),('organization-b');
          insert into documents values (1,'organization-a'),(2,'organization-b');
          alter table documents enable row level security;
          alter table document_versions enable row level security;
          grant usage on schema public to authenticated;
          grant select on documents, document_versions to authenticated;
          create policy document_tenant_read on documents for select to authenticated
            using (organization_id=current_setting('rehearsal.organization_id',true));
          create policy version_tenant_read on document_versions for select to authenticated
            using (organization_id=current_setting('rehearsal.organization_id',true));
          ${documents.map(document => `insert into document_versions values (${document.id},${document.organization === 'organization-a' ? 1 : 2},'${document.organization}','${document.key}','${hash(document.content)}',${Buffer.byteLength(document.content)});`).join('\n')}
        `);
        for (const document of documents) await put(target.sourceBucket, document.key, document.content);
      },
      backup: async () => {
        databaseBackup = await command(['docker', 'exec', databaseContainer, 'pg_dump', '-U', 'postgres',
          '--format=plain', '--no-owner', '--dbname', target.sourceDatabase]);
        if (!databaseBackup.includes('document_versions')) throw new Error('Empty database backup.');
        for (const document of documents) {
          const content = await get(target.sourceBucket, document.key);
          if (hash(content) !== hash(document.content)) throw new Error('Source content mismatch.');
          await put(target.backupBucket, document.key, content);
        }
      },
      'remove-source': async () => {
        await sql(target.sourceDatabase, 'truncate document_versions,documents,organizations;');
        await removeObjects(target.sourceBucket);
        if (await sql(target.sourceDatabase, 'select count(*) from document_versions') !== '0') throw new Error('Source loss not established.');
        for (const document of documents) {
          try {
            await objectStore.send(new HeadObjectCommand({ Bucket: target.sourceBucket, Key: document.key }));
            throw new Error('Source object still exists.');
          } catch (error) {
            if (!(error instanceof Error) || error.name !== 'NotFound') throw error;
          }
        }
      },
      restore: async () => {
        if (!databaseBackup) throw new Error('Missing completed database backup.');
        await sql(target.restoredDatabase, databaseBackup);
        for (const document of documents) await put(target.restoredBucket, document.key, await get(target.backupBucket, document.key));
      },
      verify: async () => {
        const counts = await sql(target.restoredDatabase, 'select (select count(*) from organizations)||\',\'||(select count(*) from documents)||\',\'||(select count(*) from document_versions)');
        if (counts !== '2,2,3') throw new Error('Restored row count mismatch.');
        record('verify-2-organizations-2-documents-3-versions', 'passed');
        for (const document of documents) {
          const content = await get(target.restoredBucket, document.key);
          const metadata = await sql(target.restoredDatabase, `select storage_path||','||sha256||','||size_bytes from document_versions where id=${document.id}`);
          if (metadata !== `${document.key},${hash(content)},${Buffer.byteLength(content)}` || content !== document.content) throw new Error('Restored file/metadata mismatch.');
        }
        record('verify-all-version-paths-sizes-hashes-and-bytes', 'passed');
        await sql(target.restoredDatabase, `do $$ begin
          begin insert into document_versions values(4,999,'organization-a','invalid','invalid',1);
            raise exception 'Foreign key accepted orphan';
          exception when foreign_key_violation then null; end;
          begin insert into document_versions values(4,1,'organization-b','invalid','invalid',1);
            raise exception 'Foreign key accepted foreign organization';
          exception when foreign_key_violation then null; end;
        end $$;`);
        record('verify-orphan-and-foreign-organization-rejection', 'passed');
        for (const [organization, expected] of [['organization-a', '1,1,2'], ['organization-b', '2,3'], ['outsider', ',']]) {
          const visible = await sql(target.restoredDatabase, `set role authenticated; set rehearsal.organization_id='${organization}';
            select coalesce((select string_agg(id::text,',' order by id) from documents),'')||','||coalesce((select string_agg(id::text,',' order by id) from document_versions),'');`);
          // Organization A sees document 1 and versions 1,2; B sees document 2 and version 3.
          if (visible !== expected) throw new Error('Restored RLS tenant boundary failed.');
        }
        record('verify-restricted-role-tenant-visibility', 'passed');
        const first = documents[0];
        const signed = await getSignedUrl(objectStore, new GetObjectCommand({ Bucket: target.restoredBucket, Key: first.key }), { expiresIn: 60 });
        const download = await fetch(signed, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (!download.ok || await download.text() !== first.content) throw new Error('Restored signed capability failed.');
        const unsigned = new URL(signed); unsigned.search = '';
        const denied = await fetch(unsigned, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (![401,403].includes(denied.status)) throw new Error('Unsigned object access was not denied.');
        const tampered = new URL(signed); tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64));
        const tamperedResponse = await fetch(tampered, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
        if (![401,403].includes(tamperedResponse.status)) throw new Error('Tampered capability was not denied.');
        record('verify-signed-access-unsigned-and-tampered-denial', 'passed');
      },
      cleanup: async () => {
        try {
          await cleanupRecoveryResources(target, resources, async (resource) => {
            if (resource.kind === 'bucket') {
              const existing = await storage.getBucket(resource.name);
              if (existing.error) {
                if ('statusCode' in existing.error && String(existing.error.statusCode) === '404') return;
                throw new Error('Bucket cleanup lookup failed.');
              }
              await removeObjects(resource.name);
              const deleted = await storage.deleteBucket(resource.name);
              if (deleted.error) throw new Error('Bucket cleanup failed.');
            } else {
              await sql('postgres', `drop database if exists ${resource.name};`);
              if (await sql('postgres', `select count(*) from pg_database where datname='${resource.name}'`) !== '0') throw new Error('Database cleanup incomplete.');
            }
          }, journal);
        } finally {
          objectStore.destroy(); databaseBackup = undefined;
        }
      },
    }, record);
    record('acceptance', 'passed');
    console.log(`Recovery rehearsal passed; redacted evidence: .agent-logs/recovery/${target.runId}/journal.json`);
    });
  });
}

if (import.meta.main) main().catch(() => {
  console.error(`Recovery rehearsal failed; no acceptance. Inspect .agent-logs/recovery/${target.runId}/journal.json if created. Provider errors, credentials and signed URLs are deliberately suppressed.`);
  process.exitCode = 1;
});
