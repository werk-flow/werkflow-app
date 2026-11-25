import { z } from '../zod';

// `bun run prod:inspect` (scripts/inspect-production.ts) answers the production
// questions agents still have without reading a table row: the migration
// ledger, schema drift against DEV, and the advisors. Its queries read the
// system catalogs and the migration versions only
// (production-inspection.test.ts), and it prints versions, object names and
// advisor findings, never a definition or a value.

export const LEDGER_QUERY = 'select version from supabase_migrations.schema_migrations order by version';
export const ledgerRowsSchema = z.array(z.object({ version: z.string() }));

const SCHEMAS = "('public', 'app_private')";

/** One row per schema object of the app: its kind, qualified name and a hash of its definition. */
export const CATALOG_QUERY = `
with ns as (
  select n.oid, n.nspname from pg_catalog.pg_namespace n where n.nspname in ${SCHEMAS}
), ext as (
  select d.classid, d.objid from pg_catalog.pg_depend d where d.deptype = 'e'
)
select kind, name, hash from (
  select 'relation' as kind, ns.nspname || '.' || c.relname as name,
    md5(concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text, c.reloptions::text,
      case when c.relkind in ('v', 'm') then pg_catalog.pg_get_viewdef(c.oid) end)) as hash
  from pg_catalog.pg_class c join ns on ns.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
    and not exists (select 1 from ext where ext.classid = 'pg_catalog.pg_class'::regclass and ext.objid = c.oid)
  union all
  select 'column', ns.nspname || '.' || c.relname || '.' || a.attname,
    md5(concat_ws('|', pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, a.attidentity,
      a.attgenerated, pg_catalog.pg_get_expr(d.adbin, d.adrelid), a.attacl::text))
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join ns on ns.oid = c.relnamespace
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and c.relkind in ('r', 'p', 'v', 'm', 'f', 'c')
    and not exists (select 1 from ext where ext.classid = 'pg_catalog.pg_class'::regclass and ext.objid = c.oid)
  union all
  select 'constraint', ns.nspname || '.' || c.relname || '.' || k.conname, md5(pg_catalog.pg_get_constraintdef(k.oid))
  from pg_catalog.pg_constraint k join pg_catalog.pg_class c on c.oid = k.conrelid join ns on ns.oid = c.relnamespace
  union all
  select 'index', ns.nspname || '.' || i.relname, md5(pg_catalog.pg_get_indexdef(i.oid))
  from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid = x.indexrelid join ns on ns.oid = i.relnamespace
  union all
  select 'trigger', ns.nspname || '.' || c.relname || '.' || t.tgname,
    md5(concat_ws('|', pg_catalog.pg_get_triggerdef(t.oid), t.tgenabled))
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join ns on ns.oid = c.relnamespace
  where not t.tgisinternal
  union all
  select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
    md5(concat_ws('|', p.permissive, p.roles::text, p.cmd, p.qual, p.with_check))
  from pg_catalog.pg_policies p where p.schemaname in ('public', 'app_private', 'storage', 'realtime')
  union all
  select 'function', ns.nspname || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
    md5(concat_ws('|', pg_catalog.pg_get_functiondef(p.oid), p.proacl::text))
  from pg_catalog.pg_proc p join ns on ns.oid = p.pronamespace
  where p.prokind in ('f', 'p')
    and not exists (select 1 from ext where ext.classid = 'pg_catalog.pg_proc'::regclass and ext.objid = p.oid)
  union all
  select 'enum', ns.nspname || '.' || t.typname, md5(string_agg(e.enumlabel, ',' order by e.enumsortorder))
  from pg_catalog.pg_enum e join pg_catalog.pg_type t on t.oid = e.enumtypid join ns on ns.oid = t.typnamespace
  group by ns.nspname, t.typname
  union all
  select 'publication', p.pubname || ':' || p.schemaname || '.' || p.tablename,
    md5(concat_ws('|', p.attnames::text, p.rowfilter))
  from pg_catalog.pg_publication_tables p where p.pubname = 'supabase_realtime'
  union all
  select 'publication', p.pubname,
    md5(concat_ws('|', p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate, p.pubviaroot))
  from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime'
) objects order by kind, name`;

export const catalogRowsSchema = z.array(z.object({ kind: z.string(), name: z.string(), hash: z.string() }));
type CatalogObject = z.infer<typeof catalogRowsSchema>[number];

/** Each object that exists in only one project or whose definition differs, by kind and name only. */
export function catalogDrift(dev: readonly CatalogObject[], prod: readonly CatalogObject[]): string[] {
  const key = (object: CatalogObject) => `${object.kind} ${object.name}`;
  const devHashes = new Map(dev.map((object) => [key(object), object.hash]));
  const prodHashes = new Map(prod.map((object) => [key(object), object.hash]));
  const drift: string[] = [];
  for (const name of [...new Set([...devHashes.keys(), ...prodHashes.keys()])].sort()) {
    const devHash = devHashes.get(name);
    const prodHash = prodHashes.get(name);
    if (prodHash === undefined) drift.push(`${name}: only on DEV`);
    else if (devHash === undefined) drift.push(`${name}: only on PROD`);
    else if (devHash !== prodHash) drift.push(`${name}: differs`);
  }
  return drift;
}

/** What PROD's migration ledger says against the committed files and DEV's ledger. */
export function ledgerFindings(input: {
  committed: readonly string[];
  prod: readonly string[];
  dev: readonly string[];
}): { pending: string[]; problems: string[]; matchesDev: boolean } {
  const prod = new Set(input.prod);
  const committed = new Set(input.committed);
  const pending = input.committed.filter((version) => !prod.has(version)).sort();
  const unknown = [...prod].filter((version) => !committed.has(version)).sort();
  const duplicates = input.prod.filter((version, index) => input.prod.indexOf(version) !== index);
  const problems = [
    ...(unknown.length > 0
      ? [
          `PROD holds versions no committed migration has: ${unknown.join(', ')}. Run from an up-to-date main.`,
        ]
      : []),
    ...(duplicates.length > 0
      ? [`PROD holds duplicate versions: ${[...new Set(duplicates)].join(', ')}.`]
      : []),
  ];
  const dev = new Set(input.dev);
  const matchesDev = dev.size === prod.size && [...prod].every((version) => dev.has(version));
  return { pending, problems, matchesDev };
}

/** A failure the inspection may print: fixed text and a status, never provider content. */
export class InspectionFailure extends Error {}

/**
 * The read-only PROD token. Only the PROD inspection job holds it, as a secret of the GitHub
 * environment `production` (.github/workflows/prod-inspect.yml); a workstation's token reaches DEV
 * only (docs/technical/environments.md#which-tool-reaches-what).
 */
const PROD_TOKEN = 'PROD_INSPECT_SUPABASE_TOKEN';

/** What a PROD read that cannot run says, so a workstation run never passes silently. */
const RUN_THE_JOB =
  'PROD is read only by the PROD inspection job: gh workflow run prod-inspect.yml -R werk-flow/werkflow-app.';

/** The `denied` text of every PROD call. */
export const PROD_DENIED = `The token cannot reach PROD. ${RUN_THE_JOB}`;

/** The PROD and DEV tokens of a run; a missing one fails the run and names where it lives. */
export function projectTokens(env: Readonly<Record<string, string | undefined>>): {
  production: string;
  dev: string;
} {
  const production = env[PROD_TOKEN];
  if (!production) throw new InspectionFailure(`${PROD_TOKEN} is not set. ${RUN_THE_JOB}`);
  const dev = env.SUPABASE_ACCESS_TOKEN;
  if (!dev) throw new InspectionFailure('SUPABASE_ACCESS_TOKEN, the DEV token, is not set.');
  return { production, dev };
}

/** What the inspection prints for a failure. Any other error's message may quote a response body. */
export function failureMessage(error: unknown): string {
  return error instanceof InspectionFailure
    ? error.message
    : 'the inspection failed outside a labelled step.';
}

type ProjectCall<T> = {
  ref: string;
  path: string;
  token: string;
  schema: z.ZodType<T>;
  /** Said after a 401 or 403: which token this was and where the read runs instead. */
  denied?: string;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
};

/**
 * One Management API call of a project, parsed with the given schema. Every
 * failure becomes an InspectionFailure that names only the path and the HTTP
 * status, so no response body reaches the output.
 */
async function callProject<T>(
  input: ProjectCall<T> & { method: 'GET' | 'POST' | 'PATCH'; body: string | null },
): Promise<T> {
  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init));
  let response: Response;
  try {
    response = await fetcher(`https://api.supabase.com/v1/projects/${input.ref}/${input.path}`, {
      method: input.method,
      headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
      body: input.body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new InspectionFailure(`${input.path}: the request failed.`);
  }
  if (!response.ok) {
    const denied = response.status === 401 || response.status === 403;
    throw new InspectionFailure(
      `${input.path} returned HTTP ${response.status}.${denied && input.denied ? ` ${input.denied}` : ''}`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new InspectionFailure(`${input.path} returned no JSON.`);
  }
  const parsed = input.schema.safeParse(body);
  if (!parsed.success) throw new InspectionFailure(`${input.path} returned an unexpected shape.`);
  return parsed.data;
}

/** One read of a project: a GET, or with `query` a POST to a query endpoint. */
export function readProject<T>(input: ProjectCall<T> & { query?: string }): Promise<T> {
  return callProject({
    ...input,
    method: input.query === undefined ? 'GET' : 'POST',
    body: input.query === undefined ? null : JSON.stringify({ query: input.query }),
  });
}

/** One PATCH of a project's configuration; only the auth sync writes, and only to DEV. */
export function patchProject<T>(input: ProjectCall<T> & { patch: Record<string, unknown> }): Promise<T> {
  return callProject({ ...input, method: 'PATCH', body: JSON.stringify(input.patch) });
}
