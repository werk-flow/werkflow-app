import { z } from 'zod';
import { requireEnv } from '../../tests/golden/support/env';

// Keep this read-only query aligned with sql:security. It detects dashboard-only
// grant drift, which local migration replay cannot observe.
export const CLOUD_SECURITY_QUERY = `
select n.nspname || '.' || p.proname || ': client definer grant' as problem
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prosecdef and n.nspname='public'
and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))
union all
select routine || ': list reader grant drift' from unnest(array[
 'public.list_customer_page(uuid,text,integer,integer)',
 'public.list_job_entries_page(uuid,uuid,boolean,jsonb)',
 'public.list_project_job_page(uuid,uuid,boolean,uuid,integer,integer)',
 'public.list_document_page(uuid,jsonb)',
 'public.list_inventory_page(uuid,jsonb)'
]) routine where to_regprocedure(routine) is null
or has_function_privilege('anon',to_regprocedure(routine),'execute')
or has_function_privilege('authenticated',to_regprocedure(routine),'execute')
or not has_function_privilege('service_role',to_regprocedure(routine),'execute')
union all
select routine || ': client lookup grant' from unnest(array[
 'app_private.check_user_exists_by_email(text)', 'app_private.get_invite_by_code(text)'
]) routine where has_function_privilege('anon',routine,'execute') or has_function_privilege('authenticated',routine,'execute')
union all
select 'get_user_org_ids: missing authenticated grant'
where not has_function_privilege('authenticated','app_private.get_user_org_ids(uuid)','execute')
union all
select 'email_change_challenges: direct client table grant'
where has_table_privilege('anon','public.email_change_challenges','SELECT,INSERT,UPDATE,DELETE')
or has_table_privilege('authenticated','public.email_change_challenges','SELECT,INSERT,UPDATE,DELETE')
union all
select 'email_change_send_windows: direct client or service table grant'
where has_table_privilege('anon','app_private.email_change_send_windows','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
or has_table_privilege('authenticated','app_private.email_change_send_windows','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
or has_table_privilege('service_role','app_private.email_change_send_windows','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
union all
select 'supabase_realtime: unsafe publication operations'
where not exists (select 1 from pg_publication where pubname='supabase_realtime'
and pubinsert and pubupdate and not pubdelete and not pubtruncate)
union all
select 'realtime_deletions: direct client mutation grant'
where has_table_privilege('anon','public.realtime_deletions','INSERT,UPDATE,DELETE')
or has_table_privilege('authenticated','public.realtime_deletions','INSERT,UPDATE,DELETE')
union all
select pt.tablename || ': missing deletion notification trigger'
from pg_publication_tables pt join pg_namespace n on n.nspname=pt.schemaname
join pg_class c on c.relname=pt.tablename and c.relnamespace=n.oid
where pt.pubname='supabase_realtime' and pt.tablename <> 'realtime_deletions'
and not exists (select 1 from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal
and t.tgname='emit_realtime_deletion' and t.tgenabled='O' and t.tgtype=9
and t.tgfoid=to_regprocedure('app_private.emit_realtime_deletion()'))
union all
select 'realtime_deletions: missing scheduled cleanup'
where not exists(select 1 from cron.job where jobname='werkflow-realtime-deletions-cleanup'
and active and schedule='*/5 * * * *' and command='select app_private.prune_realtime_deletions()');
`;

const resultSchema = z.array(z.object({ problem: z.string() }));

export async function getDevSecurityProblems(request: typeof fetch = fetch): Promise<string[]> {
  const response = await request('https://api.supabase.com/v1/projects/mbkkzuqjbdvzelqvuzcn/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${requireEnv('SUPABASE_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: CLOUD_SECURITY_QUERY }),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (response.status !== 201) throw new Error(`DEV security metadata query returned HTTP ${response.status}.`);
  return resultSchema.parse(await response.json()).map((row) => row.problem);
}
