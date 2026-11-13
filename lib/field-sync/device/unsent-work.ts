'use client';

import { logError } from '@/lib/logging';

// What a sign-out or an organization switch asks before it ends the session
// (decision record 0010, "Device data"): unsent work is the person's work,
// not a cache, so the static wipe never touches it. Each kind of unsent work
// registers one source. The flow first sends, then names what is left, and
// ends the session only when nothing is left or the person chose to discard
// it (lib/field-sync/device/unsent-work-gate.ts asks).

/**
 * One piece of a line that the question names on its own, such as a report draft: its id among the
 * line's `ids`, and what the person recognizes it by, never its content.
 */
type UnsentWorkEntry = { id: string; name: string; detail: string };

/**
 * One line of what is still unsent, such as „Stempelzeiten“ with their number, and the ids of what
 * it names: a discard deletes exactly those, never what was kept after the question. `entries`
 * names each piece when the person must recognize it to decide.
 */
export type UnsentWorkItem = {
  label: string;
  count: number;
  ids: readonly string[];
  entries?: readonly UnsentWorkEntry[];
};

/**
 * Whose work a flow asks about. `session`: the signed-in person's in every organization, before a
 * sign-out ends them all (the default). `organization`: only the active organization's, before a
 * switch leaves it; the other organizations' work is sent once the person works there.
 */
export type UnsentScope = 'session' | 'organization';

export type UnsentSource = {
  name: string;
  /** What this source still holds in the scope; no entry when nothing. */
  summarize(scope?: UnsentScope): Promise<UnsentWorkItem[]>;
  /** Sends what it can now. What the server did not accept stays. */
  flush(): Promise<void>;
  /** Deletes what this source holds in the scope among `ids`, the ids the person was shown. */
  discard(scope: UnsentScope, ids: readonly string[]): Promise<void>;
};

/**
 * A discard that waited for a send in flight, such as a save in a dead spot, until its limit, and
 * deleted nothing. The question says so; „Abbrechen“ keeps the session.
 */
export class UnsentWorkBusyError extends Error {
  constructor() {
    super('a send in flight did not end in time; nothing was deleted');
    this.name = 'UnsentWorkBusyError';
  }
}

const sources: UnsentSource[] = [];

/** Registers one kind of unsent work. A second registration under the same name replaces the first. */
export function registerUnsentSource(source: UnsentSource): void {
  const known = sources.findIndex((entry) => entry.name === source.name);
  if (known === -1) sources.push(source);
  else sources[known] = source;
}

/**
 * Everything still unsent, in the sources' order. Throws when a source cannot
 * read its store: a flow that cannot tell whether work is left must not end
 * the session.
 */
export async function summarizeUnsentWork(scope: UnsentScope): Promise<UnsentWorkItem[]> {
  const items: UnsentWorkItem[] = [];
  for (const source of [...sources])
    items.push(...(await source.summarize(scope)).filter((item) => item.count > 0));
  return items;
}

/** Sends what every source can send now and answers what is left. A failed send leaves its work unsent. */
export async function flushUnsentWork(scope: UnsentScope = 'session'): Promise<UnsentWorkItem[]> {
  for (const source of [...sources]) {
    try {
      await source.flush();
    } catch (error) {
      // best-effort: the summary below still names this source's work, so the person decides about it.
      logError('unsent work: flush failed', { source: source.name, error });
    }
  }
  return summarizeUnsentWork(scope);
}

/**
 * Deletes the unsent work the person was shown in `items`, after they chose „Verwerfen“, and
 * answers what is left: work kept after the question. Throws when a source cannot delete.
 */
export async function discardUnsentWork(
  items: readonly UnsentWorkItem[],
  scope: UnsentScope = 'session',
): Promise<UnsentWorkItem[]> {
  const ids = items.flatMap((item) => item.ids);
  for (const source of [...sources]) await source.discard(scope, ids);
  return summarizeUnsentWork(scope);
}
