import { describe, expect, test } from 'bun:test';

import { blocksFieldLifecycleActions } from './field-state';

describe('field dispatch state', () => {
  test('fails closed until dispatch is loaded successfully', () => {
    expect(blocksFieldLifecycleActions({ status: 'loading', hasPending: false })).toBe(true);
    expect(blocksFieldLifecycleActions({ status: 'error', hasPending: false })).toBe(true);
  });

  test('blocks lifecycle actions whenever a current dispatch is pending', () => {
    expect(blocksFieldLifecycleActions({ status: 'ready', hasPending: true })).toBe(true);
    expect(blocksFieldLifecycleActions({ status: 'ready', hasPending: false })).toBe(false);
  });
});
