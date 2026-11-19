import { expect, test } from 'bun:test';
import { Children, isValidElement, type ReactNode } from 'react';

import AppPageError from '@/app/(app)/error';
import { SectionError } from '@/components/ui/section-error';

// Rule test: the retry of a failed page reads the route again. Next's `reset`
// only re-renders the payload that failed, so a failed server read stayed
// failed until the user navigated away; `retry` refreshes the route first.

function findElement(node: ReactNode, type: unknown): { props: Record<string, unknown> } | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return { props: { ...child.props } };
    const found = findElement(child.props.children, type);
    if (found) return found;
  }
  return undefined;
}

test('the page error boundary retries by reading the route again', () => {
  const retry = () => {};
  expect(findElement(AppPageError({ retry }), SectionError)?.props.onRetry).toBe(retry);
});
