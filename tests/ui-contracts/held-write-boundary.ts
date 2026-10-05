// The write gate of the immediate-feedback contracts: every stubbed write
// waits here until the spec answers it, so a contract can observe the surface
// between the click and the server answer.

type HeldWriteState = {
  /** Every write the surface issued, in order, with its arguments. */
  calls: Array<{ kind: string; input: unknown }>;
  /** Answers the open write: `null` accepts it, a string refuses it with that error code. */
  answer: ((refusal: string | null) => void) | null;
};

declare global {
  interface Window {
    uiContractWrites: HeldWriteState;
  }
}

window.uiContractWrites = { calls: [], answer: null };

/** Records the write and resolves with the spec's answer: `null` accepted, else the refusal code. */
export async function holdWrite(kind: string, input: unknown): Promise<string | null> {
  const state = window.uiContractWrites;
  state.calls.push({ kind, input });
  const refusal = await new Promise<string | null>((resolve) => {
    state.answer = resolve;
  });
  state.answer = null;
  return refusal;
}

export async function unexpectedWrite(): Promise<never> {
  throw new Error('Unexpected write in isolated UI contracts.');
}
