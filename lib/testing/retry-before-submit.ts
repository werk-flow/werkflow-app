import { MeasurementFailure } from "./live-observation";

/** Only preparation may repeat. A submit error can mean the write committed. */
export async function retryBeforeSubmit(input: {
  prepare: () => Promise<void>;
  submit: () => Promise<void>;
  canRetryPreparation: () => Promise<boolean>;
  attempts?: number;
}): Promise<void> {
  const attempts = input.attempts ?? 3;
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Preparation attempts must be a positive integer.");
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      await input.prepare();
      break;
    } catch (error) {
      if (error instanceof MeasurementFailure) throw error;
      if (attempt >= attempts || !(await input.canRetryPreparation()))
        throw error;
    }
  }
  await input.submit();
}
