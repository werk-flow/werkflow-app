import { expect, test } from "bun:test";
import {
  invalidatesLiveObservation,
  observeDuringMutation,
  observeWithoutNavigation,
  ResponsivenessError,
  type LiveObservation,
} from "./live-observation";

test("observes from submission while a delayed producer is still settling", async () => {
  let clock = 0;
  let releaseObserver: (() => void) | undefined;
  const records: LiveObservation[] = [];
  const measured = await observeDuringMutation({
      targetMs: 2000,
    now: () => clock,
    observe: () =>
      new Promise<void>((resolve) => {
        releaseObserver = resolve;
      }),
    mutation: async (beforeSubmit) => {
      clock = 1000; // Form preparation is outside the delivery interval.
      await beforeSubmit();
      clock = 2500;
      releaseObserver?.();
      await Promise.resolve();
      clock = 7000; // Producer acknowledgement arrives after the observed UI.
    },
    record: (record) => {
      records.push(record);
    },
  });
  expect(measured).toBe(1500);
  expect(records).toEqual([{ status: "visible", measuredMs: 1500, targetMs: 2000, correctness: "observed", responsiveness: "within_target" }]);
});

test("archives observer failure and preserves its error", async () => {
  const failure = new Error("Delivery timed out");
  const records: LiveObservation[] = [];
  await expect(
    observeDuringMutation({
      targetMs: 2000,
      now: () => 10,
      mutation: async (beforeSubmit) => {
        beforeSubmit();
      },
      observe: async () => {
        throw failure;
      },
      record: (record) => {
        records.push(record);
      },
    }),
  ).rejects.toMatchObject({ name: "MeasurementFailure", cause: failure });
  expect(records).toEqual([{ status: "observation_failed", measuredMs: 0, targetMs: 2000, correctness: "not_observed", responsiveness: "unconfirmed" }]);
});

test("refuses a measurement started after the mutation", async () => {
  await expect(
    observeDuringMutation({
      targetMs: 2000,
      mutation: async () => {},
      observe: async () => {},
      record: () => {},
    }),
  ).rejects.toThrow("submission boundary");
});

test("archives an uncertain submit failure without losing the producer error", async () => {
  const failure = new Error("Acknowledgement lost after submit");
  const records: LiveObservation[] = [];
  let clock = 0;
  await expect(
    observeDuringMutation({
      targetMs: 2000,
      now: () => clock,
      mutation: async (beforeSubmit) => {
        beforeSubmit();
        clock = 1200;
        throw failure;
      },
      observe: async () => {},
      record: (record) => {
        records.push(record);
      },
    }),
  ).rejects.toMatchObject({ name: "MeasurementFailure", cause: failure });
  expect(records).toEqual([{ status: "mutation_failed", measuredMs: 1200, targetMs: 2000, correctness: "unconfirmed", responsiveness: "unconfirmed" }]);
});

test("rejects multiple submissions in one measurement", async () => {
  await expect(
    observeDuringMutation({
      targetMs: 2000,
      mutation: async (beforeSubmit) => {
        beforeSubmit();
        beforeSubmit();
      },
      observe: async () => {},
      record: () => {},
    }),
  ).rejects.toThrow("exactly one submission");
});


test("a correct result after ten seconds fails responsiveness and keeps correctness evidence", async () => {
  let clock = 0;
  const records: LiveObservation[] = [];
  let mutations = 0;
  let observations = 0;
  const result = observeDuringMutation({
    targetMs: 2000,
    now: () => clock,
    mutation: async (beforeSubmit) => { mutations += 1; beforeSubmit(); },
    observe: async () => { observations += 1; clock = 10_000; },
    record: (measurement) => { records.push(measurement); },
  });
  await expect(result).rejects.toBeInstanceOf(ResponsivenessError);
  expect(mutations).toBe(1);
  expect(observations).toBe(1);
  expect(records).toEqual([{
    status: "visible", correctness: "observed", responsiveness: "over_target",
    targetMs: 2000, measuredMs: 10_000,
  }]);
});

test("the responsiveness deadline includes producer response time and cannot reset afterwards", async () => {
  let clock = 0;
  let finishObservation!: () => void;
  const pendingObservation = new Promise<void>((resolve) => { finishObservation = resolve; });
  const records: LiveObservation[] = [];
  await expect(observeDuringMutation({
    targetMs: 2000,
    now: () => clock,
    mutation: async (beforeSubmit) => {
      beforeSubmit();
      clock = 9000;
      finishObservation();
    },
    observe: () => pendingObservation,
    record: (measurement) => { records.push(measurement); },
  })).rejects.toBeInstanceOf(ResponsivenessError);
  expect(records[0]?.measuredMs).toBe(9000);
});

test("the exact deadline passes but one millisecond over fails", async () => {
  for (const elapsed of [2000, 2001]) {
    let clock = 0;
    const outcome = observeDuringMutation({
      targetMs: 2000,
      now: () => clock,
      mutation: async (beforeSubmit) => { beforeSubmit(); },
      observe: async () => { clock = elapsed; },
      record: () => {},
    });
    if (elapsed === 2000) expect(await outcome).toBe(2000);
    else await expect(outcome).rejects.toBeInstanceOf(ResponsivenessError);
  }
});

test("invalid timing contracts fail before any mutation", async () => {
  let mutations = 0;
  for (const targetMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await expect(observeDuringMutation({
      targetMs,
      mutation: async () => { mutations += 1; },
      observe: async () => {},
      record: () => {},
    })).rejects.toThrow("finite positive");
  }
  expect(mutations).toBe(0);
});

test("synchronous observer failures stay observation failures", async () => {
  const failure = new Error("Browser connection unavailable");
  const records: LiveObservation[] = [];
  await expect(observeDuringMutation({
    targetMs: 2000,
    mutation: async (beforeSubmit) => { beforeSubmit(); },
    observe: () => { throw failure; },
    record: (measurement) => { records.push(measurement); },
  })).rejects.toMatchObject({ name: "MeasurementFailure", cause: failure });
  expect(records[0]?.status).toBe("observation_failed");
  expect(records[0]?.responsiveness).toBe("unconfirmed");
});

test("a receiver reload cannot manufacture a successful live result", async () => {
  let navigate!: () => void;
  let subscriptions = 0;
  let removals = 0;
  await expect(observeWithoutNavigation({
    subscribeNavigation: (listener) => {
      subscriptions += 1;
      navigate = listener;
      return () => { removals += 1; };
    },
    observe: async () => { navigate(); },
  })).rejects.toThrow("navigated or reloaded");
  expect(subscriptions).toBe(1);
  expect(removals).toBe(1);
});

test("same-URL history updates preserve observation but document reloads and route changes reject it", async () => {
  const initialUrl = "http://localhost:3100/kunden?sort=name";
  const cases = [
    { event: { kind: "frame-location", url: initialUrl }, rejects: false },
    { event: { kind: "document-request", url: initialUrl }, rejects: true },
    { event: { kind: "frame-location", url: "http://localhost:3100/kunden?sort=created" }, rejects: true },
    { event: { kind: "frame-location", url: "http://localhost:3100/auftraege" }, rejects: true },
  ] satisfies Array<{
    event: Parameters<typeof invalidatesLiveObservation>[0]["event"];
    rejects: boolean;
  }>;
  for (const scenario of cases) {
    let navigate!: () => void;
    let removals = 0;
    const observation = observeWithoutNavigation({
      subscribeNavigation: (listener) => {
        navigate = listener;
        return () => { removals += 1; };
      },
      observe: async () => {
        if (invalidatesLiveObservation({ initialUrl, event: scenario.event })) navigate();
      },
    });
    if (scenario.rejects) await expect(observation).rejects.toThrow("navigated or reloaded");
    else await observation;
    expect(removals).toBe(1);
  }
});

test("successful observation releases its navigation listener", async () => {
  let removals = 0;
  await observeWithoutNavigation({
    subscribeNavigation: () => () => { removals += 1; },
    observe: async () => {},
  });
  expect(removals).toBe(1);
});

test("observer failure releases its navigation listener and preserves the cause", async () => {
  const failure = new Error("Locator unavailable");
  let removals = 0;
  await expect(observeWithoutNavigation({
    subscribeNavigation: () => () => { removals += 1; },
    observe: async () => { throw failure; },
  })).rejects.toBe(failure);
  expect(removals).toBe(1);
});


test("a five-second opening contract cannot pass a five-second shell plus ten-second options wait", async () => {
  let clock = 0;
  let shellReady!: () => void;
  let optionsReady!: () => void;
  const shell = new Promise<void>((resolve) => { shellReady = resolve; });
  const options = new Promise<void>((resolve) => { optionsReady = resolve; });
  const records: LiveObservation[] = [];
  await expect(observeDuringMutation({
    targetMs: 5000,
    now: () => clock,
    mutation: async (beforeOpen) => {
      beforeOpen();
      clock = 5000;
      shellReady();
      await Promise.resolve();
      clock = 15_000;
      optionsReady();
    },
    observe: async () => { await shell; await options; },
    record: (measurement) => { records.push(measurement); },
  })).rejects.toBeInstanceOf(ResponsivenessError);
  expect(records).toEqual([{
    status: "visible", correctness: "observed", responsiveness: "over_target",
    targetMs: 5000, measuredMs: 15_000,
  }]);
});
