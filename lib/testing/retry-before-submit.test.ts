import { MeasurementFailure, observeDuringMutation, type LiveObservation } from "./live-observation";
import { expect, test } from "bun:test";
import { retryBeforeSubmit } from "./retry-before-submit";

test("retries a lost preparation but submits exactly once", async () => {
  let preparations = 0;
  let submissions = 0;
  await retryBeforeSubmit({
    prepare: async () => {
      preparations += 1;
      if (preparations === 1) throw new Error("Dialog remounted");
    },
    canRetryPreparation: async () => true,
    submit: async () => {
      submissions += 1;
    },
  });
  expect(preparations).toBe(2);
  expect(submissions).toBe(1);
});

test("never retries a submit which writes before its acknowledgement fails", async () => {
  let writes = 0;
  let preparations = 0;
  const failure = new Error("Response lost after commit");
  await expect(
    retryBeforeSubmit({
      prepare: async () => {
        preparations += 1;
      },
      canRetryPreparation: async () => true,
      submit: async () => {
        writes += 1;
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
  expect(writes).toBe(1);
  expect(preparations).toBe(1);
});

test("preserves preparation failures while the dialog remains mounted", async () => {
  let submissions = 0;
  const failure = new Error("Validation control missing");
  await expect(
    retryBeforeSubmit({
      prepare: async () => {
        throw failure;
      },
      canRetryPreparation: async () => false,
      submit: async () => {
        submissions += 1;
      },
    }),
  ).rejects.toBe(failure);
  expect(submissions).toBe(0);
});


test("a vanished dialog cannot retry a failed measured opening or hide it behind a fast retry", async () => {
  for (const kind of ["observation", "deadline", "opening"] as const) {
    const original = new Error("Dialog disappeared before its controls were ready");
    let clock = 0;
    let preparations = 0;
    let retryChecks = 0;
    let submissions = 0;
    const records: LiveObservation[] = [];
    const outcome = await retryBeforeSubmit({
      prepare: async () => {
        preparations += 1;
        await observeDuringMutation({
          targetMs: 5000,
          now: () => clock,
          mutation: async (beforeOpen) => {
            beforeOpen();
            if (kind === "opening") throw original;
          },
          observe: async () => {
            clock = 15_000;
            if (kind === "observation") throw original;
          },
          record: (measurement) => { records.push(measurement); },
        });
      },
      canRetryPreparation: async () => {
        retryChecks += 1;
        return true; // The old vanished-dialog condition would permit a retry.
      },
      submit: async () => { submissions += 1; },
    }).then(() => undefined, (error: unknown) => error);
    expect(outcome).toBeInstanceOf(MeasurementFailure);
    if (outcome instanceof MeasurementFailure && kind !== "deadline") {
      expect(outcome.cause).toBe(original);
      expect(outcome.message).toContain(original.message);
    }
    expect(preparations).toBe(1);
    expect(retryChecks).toBe(0);
    expect(submissions).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]?.status).toBe(kind === "deadline" ? "visible" : kind === "opening" ? "mutation_failed" : "observation_failed");
  }
});
