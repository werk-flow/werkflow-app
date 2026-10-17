import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';

// Probes of the UI round of 2026-10-17 (UI audit of 2026-10-15): each planted
// source shows one banned spelling the effective configuration rejects and the
// sanctioned spelling it keeps.

const eslint = createProbeLinter();

/** The messages of one rule family for a source at a path. */
async function messages(source, filePath = 'components/styling-probe.tsx') {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    ({ ruleId }) => ruleId === 'no-restricted-syntax' || ruleId?.startsWith('ui/'),
  );
}

async function matching(source, prefix, filePath) {
  return (await messages(source, filePath)).filter(({ message }) => message.startsWith(prefix));
}

const classProbe = (classes) => `export const P = () => <div className="${classes}" />;`;

describe('styling class bans', () => {
  test('a viewport height is a dynamic unit; vh and h-screen fail', async () => {
    for (const classes of ['max-h-[80vh]', 'min-h-[calc(100vh-3rem)]', 'sm:max-h-[90vh]', 'h-screen']) {
      expect(await matching(classProbe(classes), 'Viewport-height layouts'), classes).toHaveLength(1);
    }
    for (const classes of ['max-h-[80dvh]', 'min-h-dvh', 'h-[min(780px,90dvh)]', 'w-[96vw]']) {
      expect(await matching(classProbe(classes), 'Viewport-height layouts'), classes).toHaveLength(0);
    }
  });

  test('the radius stops at rounded-lg on every corner', async () => {
    for (const classes of [
      'rounded-xl',
      'rounded-t-xl',
      'sm:rounded-2xl',
      'rounded-[4px]',
      'rounded-tl-3xl',
    ]) {
      expect(await matching(classProbe(classes), 'The radius scale'), classes).toHaveLength(1);
    }
    for (const classes of ['rounded-lg', 'rounded-t-lg', 'rounded-full', 'rounded-sm', 'rounded-md']) {
      expect(await matching(classProbe(classes), 'The radius scale'), classes).toHaveLength(0);
    }
  });

  test('an arbitrary hex value fails under any utility and arbitrary property', async () => {
    for (const classes of [
      'shadow-[#000]',
      'from-[#ff7900]',
      'outline-[#abc]',
      '[color:#123456]',
      'bg-[#fff]',
    ]) {
      expect(await matching(classProbe(classes), 'Arbitrary hex color'), classes).toHaveLength(1);
    }
    expect(
      await matching(classProbe('bg-primary text-primary-foreground'), 'Arbitrary hex color'),
    ).toHaveLength(0);
  });

  test('an arbitrary font size leaves the type scale', async () => {
    for (const classes of ['text-[10px]', 'sm:text-[11px]', 'text-[0.8rem]', '!text-[9px]']) {
      expect(await matching(classProbe(classes), 'An arbitrary font size'), classes).toHaveLength(1);
    }
    for (const classes of ['text-xs', 'text-sm/6', 'text-[var(--size)]']) {
      expect(await matching(classProbe(classes), 'An arbitrary font size'), classes).toHaveLength(0);
    }
  });

  test('focus keeps a neutral border; a focus border color fails, registry included', async () => {
    for (const classes of [
      'focus-visible:border-ring',
      'focus-within:border-ring',
      'has-focus:border-ring',
    ]) {
      expect(await matching(classProbe(classes), 'Focus is one 2px ring'), classes).toHaveLength(1);
      expect(
        await matching(classProbe(classes), 'Focus is one 2px ring', 'components/ui/probe-control.tsx'),
        classes,
      ).toHaveLength(1);
    }
    expect(
      await matching(classProbe('focus-visible:ring-2 focus-visible:ring-ring/50'), 'Focus is one'),
    ).toHaveLength(0);
  });

  test('a class-string module under components carries the JSX class bans', async () => {
    const source = "export const STATE_CLASSES = { done: 'bg-green-100 text-green-800' } as const;";
    expect(
      await matching(source, 'Numbered palette classes', 'components/auftraege/probe-classes.ts'),
    ).toHaveLength(1);
  });

  test('app/globals.css sets no vh length', () => {
    const stylesheet = readFileSync(resolve(import.meta.dir, '../../app/globals.css'), 'utf8');
    expect(stylesheet.match(/\b\d+(\.\d+)?vh\b/g) ?? []).toEqual([]);
  });
});

describe('screen structure', () => {
  test('a page renders no second main landmark; the shell and StandaloneScreen own it', async () => {
    const source = 'export const P = () => <main className="space-y-6">Inhalt</main>;';
    expect(await matching(source, 'The app shell and StandaloneScreen own')).toHaveLength(1);
    expect(
      await matching(
        source,
        'The app shell and StandaloneScreen own',
        'components/shared/standalone-screen.tsx',
      ),
    ).toHaveLength(0);
    expect(
      await matching(source, 'The app shell and StandaloneScreen own', 'components/sidebar/app-shell.tsx'),
    ).toHaveLength(0);
  });

  test('a screen outside the shell takes its h1 from StandaloneTitle', async () => {
    const source = 'export default function P() { return <h1 className="text-3xl font-bold">Titel</h1>; }';
    for (const filePath of ['app/onboarding/start/page.tsx', 'app/upgrade/page.tsx', 'app/not-found.tsx']) {
      expect(await matching(source, 'Raw <h1>', filePath), filePath).toHaveLength(1);
    }
    expect(await matching(source, 'Raw <h1>', 'components/shared/standalone-screen.tsx')).toHaveLength(0);
  });
});

describe('forms and running actions', () => {
  test('a validation path focuses through focusFirstInvalidField, not by id', async () => {
    for (const call of [
      "document.getElementById('reason')?.focus();",
      "document.getElementById('reason').focus();",
      "document.querySelector<HTMLElement>('#dispatch-recipients')?.focus();",
    ]) {
      const source = `export function submit() { ${call} }`;
      expect(await matching(source, 'Focus a field through focusFirstInvalidField'), call).toHaveLength(1);
      expect(
        await matching(source, 'Focus a field through focusFirstInvalidField', 'components/probe-form.ts'),
        call,
      ).toHaveLength(1);
    }
    const kept = 'export function submit(ref: { current: HTMLElement | null }) { ref.current?.focus(); }';
    expect(await matching(kept, 'Focus a field through focusFirstInvalidField')).toHaveLength(0);
  });

  test('a running action is Button pending, never a Spinner swapped in by hand', async () => {
    for (const source of [
      'export const P = ({ busy }) => <Button>{busy ? <Spinner /> : <Save />}Speichern</Button>;',
      'export const P = ({ busy }) => <AlertDialogAction>{busy && <Spinner className="mr-2" />}Löschen</AlertDialogAction>;',
    ]) {
      expect(await matching(source, 'A running action is `Button pending'), source).toHaveLength(1);
    }
    for (const source of [
      'export const P = ({ busy }) => <Button pending={busy}><Save />Speichern</Button>;',
      'export const P = () => <div><Spinner label="Wird geladen" /></div>;',
    ]) {
      expect(await matching(source, 'A running action is `Button pending'), source).toHaveLength(0);
    }
  });
});

describe('no code on screen', () => {
  test('a label lookup that falls back to its own key fails', async () => {
    for (const expression of [
      'LABELS[code] ?? code',
      'LABELS[item.state as keyof typeof LABELS] ?? item.state',
      'LABELS?.[code] || code',
      'labels.get(id) ?? id',
    ]) {
      const source = `export const label = (code: string, item: { state: string }, id: string) => ${expression};`;
      expect(
        (await messages(source, 'components/probe-label.tsx')).filter(
          ({ ruleId }) => ruleId === 'ui/no-raw-code-fallback',
        ),
        expression,
      ).toHaveLength(1);
    }
    for (const expression of [
      "LABELS[code] ?? 'Status unbekannt'",
      'LABELS[code] ?? other',
      'value ?? code',
    ]) {
      const source = `export const label = (code: string, other: string, value: string) => ${expression};`;
      expect(
        (await messages(source, 'components/probe-label.tsx')).filter(
          ({ ruleId }) => ruleId === 'ui/no-raw-code-fallback',
        ),
        expression,
      ).toHaveLength(0);
    }
  });
});
