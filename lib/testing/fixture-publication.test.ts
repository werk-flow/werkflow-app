import { expect, test } from "bun:test";
import { waitForFixturePublication, type FixturePublicationObserver } from "./fixture-publication";

test("fixture publication waits for the joined receiver, one write and its exact receipt", async () => {
  let observer!: FixturePublicationObserver;
  let finishWrite!: () => void;
  let writes = 0;
  let disposed = 0;
  let completed = false;
  const operation = waitForFixturePublication({
    subscribe: (registered) => { observer = registered; return async () => { disposed += 1; }; },
    write: () => { writes += 1; return new Promise<void>((resolve) => { finishWrite = resolve; }); },
  }).then(() => { completed = true; });
  observer.marker();
  expect(writes).toBe(0);
  observer.ready();
  observer.ready();
  await Promise.resolve();
  expect(writes).toBe(1);
  finishWrite();
  await Promise.resolve();
  expect(completed).toBe(false);
  observer.marker();
  await operation;
  expect(completed).toBe(true);
  expect(disposed).toBe(1);
});

test("a receipt before the write response cannot finish setup early", async () => {
  let observer!: FixturePublicationObserver;
  let finishWrite!: () => void;
  let completed = false;
  const operation = waitForFixturePublication({
    subscribe: (registered) => { observer = registered; return async () => undefined; },
    write: () => new Promise<void>((resolve) => { finishWrite = resolve; }),
  }).then(() => { completed = true; });
  observer.ready();
  await Promise.resolve();
  observer.marker();
  await Promise.resolve();
  expect(completed).toBe(false);
  finishWrite();
  await operation;
});

test("a failed subscription cannot start the fixture write", async () => {
  let observer!: FixturePublicationObserver;
  let writes = 0;
  let disposed = false;
  const operation = waitForFixturePublication({
    subscribe: (registered) => { observer = registered; return async () => { disposed = true; }; },
    write: async () => { writes += 1; },
  });
  observer.failed(new Error("provider unavailable"));
  observer.ready();
  await expect(operation).rejects.toThrow("provider unavailable");
  expect(writes).toBe(0);
  expect(disposed).toBe(true);
});

test("a failed write stays failed even when a receipt was observed", async () => {
  let observer!: FixturePublicationObserver;
  const operation = waitForFixturePublication({
    subscribe: (registered) => { observer = registered; return async () => undefined; },
    write: async () => { throw new Error("write failed"); },
  });
  observer.ready();
  observer.marker();
  await expect(operation).rejects.toThrow("write failed");
});

test("subscription failure immediately after readiness cancels a write not yet started", async () => {
  let observer!: FixturePublicationObserver;
  let writes = 0;
  const operation = waitForFixturePublication({
    subscribe: (registered) => { observer = registered; return async () => undefined; },
    write: async () => { writes += 1; },
  });
  observer.ready();
  observer.failed(new Error("subscription lost before write"));
  await expect(operation).rejects.toThrow("subscription lost before write");
  expect(writes).toBe(0);
});

test("missing publication has a bounded setup failure and closes its subscription", async () => {
  let disposed = false;
  const operation = waitForFixturePublication({
    subscribe: () => async () => { disposed = true; },
    write: async () => { throw new Error("must not write before joining"); },
    timeoutMs: 5,
  });
  await expect(operation).rejects.toThrow("setup deadline");
  expect(disposed).toBe(true);
});
