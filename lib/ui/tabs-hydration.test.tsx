import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { PageActionButton, PageActionProvider } from '../../components/shared/page-action';

test('a page dialog action cannot accept clicks before its event handler hydrates', () => {
  const html = renderToStaticMarkup(
    <PageActionProvider>
      <PageActionButton>Auftrag erstellen</PageActionButton>
    </PageActionProvider>,
  );
  expect(html.match(/<button\b[^>]*>/)?.[0]).toContain('disabled=""');
});

test('server-rendered tabs cannot accept a selection before their event handlers hydrate', () => {
  const html = renderToStaticMarkup(
    <Tabs defaultValue="week">
      <TabsList>
        <TabsTrigger value="week">Woche</TabsTrigger>
        <TabsTrigger value="month">Monat</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  const buttons = html.match(/<button\b[^>]*>/g) ?? [];
  expect(buttons).toHaveLength(2);
  for (const button of buttons) expect(button).toContain('disabled=""');
});
