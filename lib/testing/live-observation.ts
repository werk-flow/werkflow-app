export type LiveObservation = {
  measuredMs: number;
  targetMs: number;
} & (
  | { status: "visible"; correctness: "observed"; responsiveness: "within_target" | "over_target" }
  | { status: "observation_failed"; correctness: "not_observed"; responsiveness: "unconfirmed" }
  | { status: "mutation_failed"; correctness: "unconfirmed"; responsiveness: "unconfirmed" }
);

/** A measured failure must reach the test runner, even if a dialog disappeared. */
export class MeasurementFailure extends Error {
  readonly measurement: LiveObservation;

  constructor(message: string, measurement: LiveObservation, cause?: unknown) {
    super(message, { cause });
    this.name = "MeasurementFailure";
    this.measurement = measurement;
  }
}

export class ResponsivenessError extends MeasurementFailure {
  constructor(measurement: LiveObservation) {
    super(`Correct result appeared after ${measurement.measuredMs}ms, exceeding the ${measurement.targetMs}ms responsiveness deadline.`, measurement);
    this.name = "ResponsivenessError";
  }
}

function measuredFailure(measurement: LiveObservation, cause: unknown): MeasurementFailure {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new MeasurementFailure(`Measured operation failed: ${detail}`, measurement, cause);
}

/** Same-URL history bookkeeping does not replace the observed page; a reload does. */
export function invalidatesLiveObservation(input: {
  initialUrl: string;
  event: { kind: "document-request" | "frame-location"; url: string };
}): boolean {
  return input.event.kind === "document-request" || input.event.url !== input.initialUrl;
}

/** Rejects visibility manufactured by navigating the receiving session. */
export async function observeWithoutNavigation(input: {
  observe: () => Promise<void>;
  subscribeNavigation: (onNavigation: () => void) => () => void;
}): Promise<void> {
  let rejectNavigation!: (error: Error) => void;
  const navigation = new Promise<never>((_resolve, reject) => { rejectNavigation = reject; });
  const unsubscribe = input.subscribeNavigation(() => {
    rejectNavigation(new Error("Freshness evidence is invalid because the receiving page navigated or reloaded."));
  });
  try {
    await Promise.race([Promise.resolve().then(input.observe), navigation]);
  } finally {
    unsubscribe();
  }
}

/** Starts observation at submission, while the producer still awaits its response. */
export async function observeDuringMutation(input: {
  targetMs: number;
  mutation: (beforeSubmit: () => void) => Promise<void>;
  observe: () => Promise<void>;
  record: (measurement: LiveObservation) => void;
  now?: () => number;
}): Promise<number> {
  if (!Number.isFinite(input.targetMs) || input.targetMs <= 0) {
    throw new Error("A responsiveness deadline must be a finite positive number.");
  }
  const now = input.now ?? (() => performance.now());
  let observation: Promise<{ measuredMs: number; error?: unknown }> | undefined;
  let startedAt: number | undefined;
  const beforeSubmit = (): void => {
    if (startedAt !== undefined)
      throw new Error("A live measurement must have exactly one submission boundary.");
    const submissionStartedAt = now();
    startedAt = submissionStartedAt;
    const observe = async (): Promise<{ measuredMs: number; error?: unknown }> => {
      try {
        await input.observe();
        return { measuredMs: now() - submissionStartedAt };
      } catch (error) {
        return { measuredMs: now() - submissionStartedAt, error };
      }
    };
    observation = observe();
  };
  try {
    await input.mutation(beforeSubmit);
  } catch (error) {
    if (startedAt !== undefined) {
      const measurement: LiveObservation = {
        status: "mutation_failed",
        correctness: "unconfirmed",
        responsiveness: "unconfirmed",
        targetMs: input.targetMs,
        measuredMs: now() - startedAt,
      };
      input.record(measurement);
      throw measuredFailure(measurement, error);
    }
    throw error;
  }
  if (!observation)
    throw new Error("Live mutation never marked its submission boundary.");
  const result = await observation;
  if ("error" in result) {
    const measurement: LiveObservation = {
      status: "observation_failed",
      correctness: "not_observed",
      responsiveness: "unconfirmed",
      targetMs: input.targetMs,
      measuredMs: result.measuredMs,
    };
    input.record(measurement);
    throw measuredFailure(measurement, result.error);
  }
  const measurement: LiveObservation = {
    status: "visible",
    correctness: "observed",
    responsiveness: result.measuredMs > input.targetMs ? "over_target" : "within_target",
    targetMs: input.targetMs,
    measuredMs: result.measuredMs,
  };
  input.record(measurement);
  if (measurement.responsiveness === "over_target") throw new ResponsivenessError(measurement);
  return result.measuredMs;
}
