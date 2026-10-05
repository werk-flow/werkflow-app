import { expect, test } from 'bun:test';
import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { UrlFlashBanner } from '../../components/ui/banner';

const inertRouter: AppRouterInstance = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: '_b_0_',
};

function renderAt(search: string): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={inertRouter}>
      <SearchParamsContext.Provider value={new URLSearchParams(search)}>
        <UrlFlashBanner paramKey="field_transition" messageTemplate="Arbeitsstand wurde aktualisiert." />
      </SearchParamsContext.Provider>
    </AppRouterContext.Provider>,
  );
}

// The first render already holds the confirmation. An update from an effect
// inherits the priority of the hydration commit that runs it, and at idle
// priority it waited behind the page's background work until the param was
// stripped (the P1-16 completion confirmation never showed).
test('the post-redirect confirmation renders with the page, not after a later update', () => {
  expect(renderAt('field_transition=updated')).toContain('Arbeitsstand wurde aktualisiert.');
});

test('without its param the page renders no confirmation', () => {
  expect(renderAt('other=1')).not.toContain('role="alert"');
});
