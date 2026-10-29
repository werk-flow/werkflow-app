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
    md5(concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text)) as hash
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
