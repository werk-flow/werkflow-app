import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { KiQuestion } from '@/components/ki/ki-rows';
import { z } from '@/lib/zod';

// WerkFlow KI's tool rows run over the real turn route with module mocks for identity, cookies and
// the database, which would leak into other test files; the fixture runs in its own process
// (lib/testing/fixtures/ai-tool-rows.ts). It replays a question a poisoned record talked the model
// into (B21); here the page's question row renders it.
test('tool calls, questions and to-do lists are thread rows, and an injected question renders inert', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/ai-tool-rows.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
  const line = stdout.split('\n').find((entry) => entry.startsWith('{"injectedQuestion"'));
  const { injectedQuestion } = z
    .object({ injectedQuestion: z.object({ question: z.string(), options: z.array(z.string()) }) })
    .parse(JSON.parse(line ?? '{}'));
  const markup = renderToStaticMarkup(
    <KiQuestion
      row={{
        key: 'c:tool:1',
        sequence: 3,
        role: 'question',
        status: 'complete',
        revision: 1,
        ...injectedQuestion,
      }}
      answered={null}
      open
      onAnswer={() => undefined}
    />,
  );
  expect(markup, 'an injected question must load nothing').not.toMatch(
    /<img|<iframe|<script|\ssrcset="|\ssrc="/,
  );
  expect(markup, 'an injected question links nowhere').not.toMatch(/href="/);
  expect(markup, 'the outside address stays visible as text').toContain('evil.example');
});
