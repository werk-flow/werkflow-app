import { expect, test } from 'bun:test';

import AppPageError from '@/app/(app)/error';
import { SectionError } from '@/components/ui/section-error';
import { field, renderTree } from '@/lib/testing/fixtures/page-render';

// Rule test: the retry of a failed page reads the route again. Next's `reset`
// only re-renders the payload that failed, so a failed server read stayed
// failed until the user navigated away; `retry` refreshes the route first.

test("the page error boundary hands Next's retry to its retry button", async () => {
  const retry = () => {};
  const elements = await renderTree(() => AppPageError({ retry }));
  const sectionError = elements.find((element) => element.type === SectionError);
  expect(field(sectionError, 'props', 'onRetry')).toBe(retry);
});
