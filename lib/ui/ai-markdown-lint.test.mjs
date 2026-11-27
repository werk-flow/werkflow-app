import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markdownRendererPattern } from '../../eslint.config.mjs';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';

// Tier 2 probe for markdownRendererPattern in eslint.config.mjs (B11): model
// text renders only through AiMarkdown, never through another Markdown or HTML renderer.
const eslint = createProbeLinter();

async function rendererMessages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  const unlinted = result.messages.filter(({ fatal, ruleId }) => fatal || ruleId === null);
  if (unlinted.length > 0) {
    throw new Error(`${filePath} was not linted: ${unlinted.map(({ message }) => message).join('; ')}`);
  }
  return result.messages.filter(
    ({ ruleId, message }) => ruleId === 'no-restricted-imports' && /only through AiMarkdown/.test(message),
  );
}

test('another Markdown or HTML renderer is rejected in product code, lib/ai/ included', async () => {
  const probes = [
    ['components/ki/probe.tsx', "import Markdown from 'react-markdown';\nexport const p = Markdown;"],
    ['components/ki/probe.tsx', "import { marked } from 'marked';\nexport const p = marked;"],
    ['app/(app)/ki/probe.tsx', "import MarkdownIt from 'markdown-it';\nexport const p = MarkdownIt;"],
    ['lib/ai/probe.ts', "import remarkGfm from 'remark-gfm';\nexport const p = remarkGfm;"],
    ['components/shared/probe.tsx', "import rehypeRaw from 'rehype-raw';\nexport const p = rehypeRaw;"],
    ['hooks/probe.ts', "import DOMPurify from 'dompurify';\nexport const p = DOMPurify;"],
  ];
  for (const [filePath, source] of probes) {
    expect(await rendererMessages(source, filePath), `${filePath}: ${source}`).toHaveLength(1);
  }
});

test('the one renderer is imported freely', async () => {
  expect(
    await rendererMessages(
      "import { AiMarkdown } from '@/components/shared/ai-markdown';\nexport const p = AiMarkdown;",
      'components/ki/probe.tsx',
    ),
  ).toEqual([]);
});

test('no Markdown or HTML renderer is a dependency, so no import form can load one', () => {
  // knip fails on an import of a package package.json does not list (static:unused), so with
  // none listed, a dynamic import or require of one fails as a static import does.
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, '../../package.json'), 'utf8'));
  const names = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  });
  const pattern = new RegExp(markdownRendererPattern.regex);
  expect(names.filter((name) => pattern.test(name))).toEqual([]);
  expect(pattern.test('react-markdown')).toBe(true);
});
