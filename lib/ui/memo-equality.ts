/**
 * The comparisons behind a memoized row (performance.md, "Improve a flow"):
 * a list or a board renders again only the rows whose shown content changed,
 * not every row for one changed row. Every prop counts as changed unless it
 * is identical or passes the content check its row names for it. A row names
 * a check only where its owner rebuilds an equal value for every row on each
 * change (a route refresh, a whole-board index), and the check compares all
 * that the row shows from that value, so a changed row never renders stale.
 */

type PropsCheck<Props> = (previous: Props, next: Props) => boolean;

/** Per prop, the content check that stands in for identity. Each entry states why identity is too strict. */
export type MemoContentChecks<Props> = { readonly [Key in keyof Props]?: PropsCheck<Props> };

function isPropKey<Props extends object>(props: Props, key: string): key is Extract<keyof Props, string> {
  return key in props;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/** A record of own fields; a map, a set or a list keeps its content out of `Object.entries`. */
function isPlainRecord(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A `memo` comparator: the props are equal when both sides pass the same
 * props and each is identical or passes its content check. A prop that only
 * one side passes counts as changed, so a new prop is compared without a
 * code change.
 */
export function memoPropsEqual<Props extends object>(checks: MemoContentChecks<Props>): PropsCheck<Props> {
  return (previous, next) => {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      if (!isPropKey(previous, key) || !isPropKey(next, key)) return false;
      const check = checks[key];
      if (check ? !check(previous, next) : !Object.is(previous[key], next[key])) return false;
    }
    return true;
  };
}

/** Whether two lists hold the same items in the same order, each item compared by identity. */
export function sameItems<Item>(previous: readonly Item[], next: readonly Item[]): boolean {
  return (
    previous === next ||
    (previous.length === next.length && previous.every((item, index) => Object.is(item, next[index])))
  );
}

/**
 * Whether two flat records carry the same fields with the same values: a
 * list field is compared item by item, any other field by identity, so a
 * changed nested object always counts as a change. A missing record equals
 * only another missing one, and a map, a set or a list only itself.
 */
export function sameFields<Shape extends object>(
  previous: Shape | null | undefined,
  next: Shape | null | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next || !isPlainRecord(previous) || !isPlainRecord(next)) return false;
  const previousEntries: [string, unknown][] = Object.entries(previous);
  const nextValues = new Map<string, unknown>(Object.entries(next));
  if (previousEntries.length !== nextValues.size) return false;
  return previousEntries.every(([key, value]) => {
    if (!nextValues.has(key)) return false;
    const nextValue = nextValues.get(key);
    return Object.is(value, nextValue) || (isList(value) && isList(nextValue) && sameItems(value, nextValue));
  });
}

/** Whether two lists hold records with the same fields in the same order (`sameFields` per item). */
export function sameRecords<Shape extends object>(
  previous: readonly Shape[],
  next: readonly Shape[],
): boolean {
  return (
    previous === next ||
    (previous.length === next.length && previous.every((item, index) => sameFields(item, next[index])))
  );
}
