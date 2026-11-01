import type { Database } from './database.types';

type Tables = Database['public']['Tables'];

/**
 * A public table's insert row in the conditional form supabase-js's `insert()` declares, so a
 * function generic over the table name passes its rows to `insert()` without a cast. For a named
 * table it is the generated `Insert` type.
 */
export type TableInsert<Table extends keyof Tables> = Tables[Table] extends { Insert: unknown }
  ? Tables[Table]['Insert']
  : never;
