import { memo, type ReactNode } from 'react';

import { TextLink } from '@/components/ui/text-link';
import { FENCE, sameOriginTarget, splitAnswerBlocks } from '@/lib/ui/ai-markdown-text';

// The one renderer of model text (B11, werk-flow/werkflow-planning#530). It
// builds React elements for a small Markdown subset and nothing else: no HTML,
// no image, and a link only to a same-origin relative path. Every other URL,
// image, reference and tag stays visible as plain text, so a model that was
// talked into sending data out has nothing that loads or navigates. Lint bans
// every other Markdown renderer in product code (eslint.config.mjs).

const INLINE =
  /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|(!?)\[([^\]\n]+)\]\(([^)\s]*)\)|\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|\b_(\S(?:.*?\S)?)_\b/g;

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, , code, bang, label, href, strong, strongAlt, em, emAlt] = match;
    nodes.push(text.slice(last, match.index));
    last = match.index + whole.length;
    const key = nodes.length;
    if (code !== undefined) nodes.push(<code key={key}>{code}</code>);
    else if (label !== undefined && href !== undefined) {
      // An image is never fetched, and a link that leaves the app is its text and its address.
      const target = bang === '' ? sameOriginTarget(href) : null;
      if (target)
        nodes.push(
          <TextLink key={key} href={target} prefetch={false}>
            {inline(label)}
          </TextLink>,
        );
      else nodes.push(bang === '' ? `${label} (${href})` : whole);
    } else if (strong !== undefined || strongAlt !== undefined)
      nodes.push(<strong key={key}>{inline(strong ?? strongAlt ?? '')}</strong>);
    else nodes.push(<em key={key}>{inline(em ?? emAlt ?? '')}</em>);
  }
  nodes.push(text.slice(last));
  return nodes;
}

const HEADING = /^ {0,3}#{1,6}\s+(.*)$/;
const LIST_ITEM = /^\s*(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

function lines(source: string[], key: number, render: (line: string) => ReactNode): ReactNode[] {
  return source.flatMap((line, index) =>
    index === 0 ? [render(line)] : [<br key={`${key}-${index}`} />, render(line)],
  );
}

/** One block of the answer: a code block, or headings, lists, quotes and paragraphs. */
function renderBlock(source: string): ReactNode[] {
  const rows = source.split('\n');
  if (FENCE.test(rows[0] ?? '')) {
    const body = rows.slice(1);
    if (FENCE.test(body.at(-1) ?? '')) body.pop();
    return [
      <pre key={0} className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap break-words">
        <code>{body.join('\n')}</code>
      </pre>,
    ];
  }
  const nodes: ReactNode[] = [];
  for (let index = 0; index < rows.length; ) {
    const row = rows[index] ?? '';
    const key = nodes.length;
    const heading = HEADING.exec(row);
    if (heading) {
      nodes.push(
        <p key={key} className="font-semibold">
          {inline(heading[1] ?? '')}
        </p>,
      );
      index += 1;
      continue;
    }
    const first = LIST_ITEM.exec(row);
    if (first) {
      const items: string[] = [];
      for (; index < rows.length; index += 1) {
        const item = LIST_ITEM.exec(rows[index] ?? '');
        if (item) items.push(item[3] ?? '');
        else if (/^\s+\S/.test(rows[index] ?? '') && items.length > 0)
          items[items.length - 1] += ` ${rows[index]?.trim()}`;
        else break;
      }
      const children = items.map((item, position) => <li key={position}>{inline(item)}</li>);
      nodes.push(
        first[2] === undefined ? (
          <ul key={key} className="list-disc space-y-1 pl-5">
            {children}
          </ul>
        ) : (
          <ol key={key} start={Number(first[2])} className="list-decimal space-y-1 pl-5">
            {children}
          </ol>
        ),
      );
      continue;
    }
    const group: string[] = [];
    const quote = QUOTE.test(row);
    for (; index < rows.length; index += 1) {
      const current = rows[index] ?? '';
      if (
        quote
          ? !QUOTE.test(current)
          : group.length > 0 && (HEADING.test(current) || LIST_ITEM.test(current) || QUOTE.test(current))
      )
        break;
      group.push(quote ? (QUOTE.exec(current)?.[1] ?? '') : current);
    }
    const content = lines(group, key, (line) => inline(line));
    nodes.push(
      quote ? (
        <blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">
          {content}
        </blockquote>
      ) : (
        <p key={key}>{content}</p>
      ),
    );
  }
  return nodes;
}

/** A finished block renders once: its source never changes, so memo keeps it (brief non-negotiable 3). */
const AnswerBlock = memo(function AnswerBlock({ source }: { source: string }) {
  return <>{renderBlock(source)}</>;
});

/** Model text as safe Markdown. Only the block still being written re-renders while the answer streams. */
export function AiMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="space-y-3 break-words">
      {splitAnswerBlocks(text).map((source, index) => (
        <AnswerBlock key={index} source={source} />
      ))}
    </div>
  );
}
