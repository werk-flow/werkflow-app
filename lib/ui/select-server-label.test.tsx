import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STATUSES = [
  ['offen', 'Offen'],
  ['abgelehnt', 'Abgelehnt'],
] as const;

function StatusFilter({ value, placeholder }: { value: string; placeholder?: string }) {
  return (
    <Select value={value} onValueChange={() => undefined}>
      <SelectTrigger aria-label="Status">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map(([status, label]) => (
          <SelectItem key={status} value={status}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The text inside the trigger of server HTML, where Radix alone would wait for hydration. */
function triggerText(html: string): string {
  const trigger = /<button[^>]*aria-label="Status"[^>]*>(.*?)<\/button>/.exec(html)?.[1] ?? '';
  return trigger.replace(/<[^>]+>/g, '');
}

describe('registry Select in server HTML', () => {
  test('the trigger shows the selected item label before hydration', () => {
    expect(triggerText(renderToStaticMarkup(<StatusFilter value="abgelehnt" />))).toBe('Abgelehnt');
  });

  test('an empty value shows the placeholder', () => {
    expect(triggerText(renderToStaticMarkup(<StatusFilter value="" placeholder="Status wählen" />))).toBe(
      'Status wählen',
    );
  });

  test('explicit SelectValue children win over the item label', () => {
    const html = renderToStaticMarkup(
      <Select value="offen" onValueChange={() => undefined}>
        <SelectTrigger aria-label="Status">
          <SelectValue>Eigene Anzeige</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="offen">Offen</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(triggerText(html)).toBe('Eigene Anzeige');
  });
});
