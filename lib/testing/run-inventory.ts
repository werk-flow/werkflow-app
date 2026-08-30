export type RunInventoryEntry = {
  runKey: string;
  status: string;
  lane: string;
  suite: string;
  target?: string | null;
  grep?: string | null;
  world?: { runId: string } | null;
  classification?: string | null;
  retainedAt?: string | null;
  cleanedAt?: string | null;
};

export type RetainedWorldState = 'none' | 'open' | 'cleaned';

export function retainedWorldState(
  entry: Pick<RunInventoryEntry, 'retainedAt' | 'cleanedAt'>,
): RetainedWorldState {
  if (entry.cleanedAt) return 'cleaned';
  if (entry.retainedAt) return 'open';
  return 'none';
}

export function formatRunInventory(
  entries: readonly RunInventoryEntry[],
  recentLimit = 30,
): string[] {
  const openEntries = entries.filter(
    (entry) => retainedWorldState(entry) === 'open',
  );
  const lines = [
    'run key | result | lane/suite/target | selection | world | retained world | classification',
  ];

  for (const entry of entries.slice(-recentLimit)) {
    lines.push(
      [
        entry.runKey,
        entry.status,
        `${entry.lane}/${entry.suite}/${entry.target ?? 'cloud'}`,
        entry.grep ?? 'full',
        entry.world?.runId ?? 'no-world',
        retainedWorldState(entry),
        entry.classification ?? 'unclassified',
      ].join(' | '),
    );
  }

  if (openEntries.length > 0) {
    lines.push(
      `[werkflow-test] Open retained run keys: ${openEntries
        .map((entry) => entry.runKey)
        .join(', ')}`,
    );
  }
  lines.push(`[werkflow-test] Open retained worlds: ${openEntries.length}`);
  return lines;
}
