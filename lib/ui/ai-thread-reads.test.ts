import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AiMarkdown } from '@/components/shared/ai-markdown';
import { z } from '@/lib/zod';

// The chat page's reads run over the real turn route with module mocks for
// identity, cookies and the database, which would leak into other test files;
// the fixture runs in its own process (lib/testing/fixtures/ai-thread-reads.ts).
// It replays an answer a poisoned document talked the model into (B21); here
// the page's renderer shows that saved answer.
test("the chat page reads only its author's threads, and an injected answer renders inert", async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/ai-thread-reads.ts')],
    {
      cwd: resolve(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
  const line = stdout.split('\n').find((entry) => entry.startsWith('{"injectedAnswer"'));
  const { injectedAnswer } = z.object({ injectedAnswer: z.string() }).parse(JSON.parse(line ?? '{}'));
  const markup = renderToStaticMarkup(createElement(AiMarkdown, { text: injectedAnswer }));
  expect(markup, 'an injected answer must load nothing').not.toMatch(
    /<img|<iframe|<script|\ssrcset="|\ssrc="/,
  );
  expect(
    [...markup.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
    'an injected answer links only to a path of the app',
  ).toEqual(['/aufgaben']);
});
