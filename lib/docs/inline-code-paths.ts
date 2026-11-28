import { markdownLinesOutsideFences } from './markdown-lines';

export type InlineCodePath = { line: number; path: string };

/**
 * Repository-shaped inline code spans, regardless of whether their targets exist: path characters
 * with a slash, ending in a folder slash or a file extension, so prose like `Handwerker/in` is no path.
 */
export function findInlineCodePaths(markdown: string): InlineCodePath[] {
  const paths: InlineCodePath[] = [];
  for (const { line, text } of markdownLinesOutsideFences(markdown)) {
    for (const match of text.matchAll(/(?<![\\`])(`+)([^`]*?)\1(?!`)/g)) {
      const path = match[2];
      if (
        path !== undefined &&
        /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]*)+$/.test(path) &&
        /(\/|\.[A-Za-z0-9]+)$/.test(path)
      )
        paths.push({ line, path });
    }
  }
  return paths;
}
