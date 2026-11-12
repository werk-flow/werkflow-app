'use client';

import { logError } from '@/lib/logging';

// What a sign-out or an organization switch asks before it ends the session
// (decision record 0010, "Device data"): unsent work is the person's work,
// not a cache, so the static wipe never touches it. Each kind of unsent work
// registers one source. The flow first sends, then names what is left, and
// ends the session only when nothing is left or the person chose to discard
// it (lib/field-sync/device/unsent-work-gate.ts asks).

/** One line of what is still unsent, such as „Zeitereignisse“ with their number. */
export type UnsentWorkItem = { label: string; count: number };

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
  /** Deletes what this source holds in the scope. */
  discard(scope?: UnsentScope): Promise<void>;
};

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
async function summarizeUnsentWork(scope: UnsentScope): Promise<UnsentWorkItem[]> {
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

/** Deletes every source's unsent work, after the person chose „Verwerfen“. Throws when a source cannot delete. */
export async function discardUnsentWork(scope: UnsentScope = 'session'): Promise<void> {
  for (const source of [...sources]) await source.discard(scope);
}
