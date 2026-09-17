/** Each batch shares only an immutable application build. Database/configuration gates stay exclusive. */
export async function runGroupSchedule<T>(input: {
  entries: readonly T[];
  jobs: 1 | 2;
  canOverlap: (entry: T) => boolean;
  run: (entry: T) => Promise<void>;
}): Promise<void> {
  let batch: T[] = [];
  const flush = async (): Promise<void> => {
    // One shared iterator: each worker takes the next entry whenever it is free.
    const queue = batch.values();
    const workers = Array.from({ length: Math.min(input.jobs, batch.length) }, async () => {
      for (const entry of queue) await input.run(entry);
    });
    const outcomes = await Promise.allSettled(workers);
    batch = [];
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  for (const entry of input.entries) {
    if (input.canOverlap(entry)) batch.push(entry);
    else { await flush(); await input.run(entry); }
  }
  await flush();
}
