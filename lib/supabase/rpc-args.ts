import type { Database } from './database.types';

type Functions = Database['public']['Functions'];
type Nullable<Args> = Args extends unknown ? { [Key in keyof Args]: Args[Key] | null } : never;

/**
 * Arguments of a database function with SQL NULL allowed. The type generator
 * emits every function parameter as non-null because Postgres declares no
 * nullability on parameters, although the functions accept NULL.
 */
export function rpcArgs<Name extends keyof Functions>(
  _functionName: Name,
  args: Nullable<Functions[Name]['Args']>,
): Functions[Name]['Args'] {
  // The one place that waives parameter null-ness; names and value types stay checked.
  // Permanent: `.rpc()` constrains its arguments to the generated types, so dropping this cast
  // means a client typed with nullable arguments. That would let null compile on every direct
  // call too, `p_organization_id` included, so one named waiver stays better than a silent one.
  return args as Functions[Name]['Args'];
}
