import { DEFAULT_IDENTITY_REALTIME_TABLES, REALTIME_DELETION_TABLE, REALTIME_PUBLISHED_TABLES, REALTIME_TABLES } from './tables';

export type PublishedTableState = {
  schemaname: string;
  tablename: string;
  replident: string;
  replident_index: string;
  replident_index_columns: string;
  deletion_trigger_valid: boolean;
};
export type PublicationFlags = { pubinsert: boolean; pubupdate: boolean; pubdelete: boolean; pubtruncate: boolean };

export function validateRealtimePublication(tables: readonly PublishedTableState[], publications: readonly PublicationFlags[]): string[] {
  const problems: string[] = [];
  const expected = new Set<string>(REALTIME_PUBLISHED_TABLES);
  const defaultIdentity = new Set<string>(DEFAULT_IDENTITY_REALTIME_TABLES);
  for (const name of expected) {
    if (!tables.some(table => table.schemaname === 'public' && table.tablename === name)) problems.push(`${name}: missing from public Realtime publication.`);
  }
  for (const table of tables) {
    if (table.schemaname !== 'public' || !expected.has(table.tablename)) problems.push(`${table.schemaname}.${table.tablename}: unexpected published table.`);
    if (defaultIdentity.has(table.tablename)) {
      if (table.replident !== 'd') problems.push(`${table.tablename}: expected DEFAULT replica identity.`);
    } else if (table.replident !== 'i' || table.replident_index_columns !== 'id,organization_id') {
      problems.push(`${table.tablename}: expected minimal USING INDEX (id, organization_id) identity.`);
    }
    if (table.tablename !== REALTIME_DELETION_TABLE && !table.deletion_trigger_valid) {
      problems.push(`${table.tablename}: missing enabled AFTER DELETE row trigger for app_private.emit_realtime_deletion().`);
    }
    if (table.tablename === REALTIME_DELETION_TABLE && table.deletion_trigger_valid) {
      problems.push(`${table.tablename}: deletion transport must not emit its own deletion notifications.`);
    }
  }
  if (publications.length !== 1) problems.push('Expected exactly one supabase_realtime publication.');
  for (const flags of publications) {
    if (!flags.pubinsert || !flags.pubupdate || flags.pubdelete || flags.pubtruncate) {
      problems.push('Realtime must publish INSERT and UPDATE only; raw DELETE/TRUNCATE bypass tenant authorization.');
    }
  }
  // Keep the domain registry separate from the transport-only table.
  if (REALTIME_TABLES.some(table => String(table) === REALTIME_DELETION_TABLE)) problems.push('Deletion transport is not a domain subscription target.');
  return problems;
}
