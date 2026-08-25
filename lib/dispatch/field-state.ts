export type FieldDispatchState = {
  status: 'loading' | 'error' | 'ready';
  hasPending: boolean;
};

export function blocksFieldLifecycleActions(state: FieldDispatchState): boolean {
  return state.status !== 'ready' || state.hasPending;
}
