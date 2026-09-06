import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useHydrated } from '../../hooks/use-hydrated';

test('client-only actions cannot accept clicks in server-rendered HTML', () => {
  function Action() {
    return <button disabled={!useHydrated()}>Zeit nachtragen</button>;
  }

  expect(renderToStaticMarkup(<Action />)).toContain('disabled=""');
});
