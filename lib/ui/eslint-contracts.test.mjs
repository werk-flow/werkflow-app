import { describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();
async function restrictions(source, filePath = 'components/ui-contract-probe.tsx') {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    ({ ruleId }) => ruleId === 'no-restricted-syntax' || ruleId?.startsWith('ui/'),
  );
}

describe('effective product UI lint configuration', () => {
  test('rejects both hand-built page column literals', async () => {
    expect(
      await restrictions(
        'export const Probe = () => <main className="h-full flex-col overflow-hidden"><div className="flex-1 overflow-auto p-4 sm:p-6" /></main>',
      ),
    ).toHaveLength(2);
  });

  test('rejects native input attributes in all three static JSX spellings', async () => {
    for (const attribute of ['type="date"', 'type={"date"}', 'type={`date`}']) {
      expect(await restrictions(`export const Probe = () => <input ${attribute}/>`)).toHaveLength(1);
    }
  });

  test('rejects functional colour literals in class strings, style values and template strings', async () => {
    for (const source of [
      'export const Probe = () => <div className="bg-[rgba(123,44,191,0.12)]" />',
      'export const Probe = () => <div style={{ color: "rgb(34 197 94 / 0.8)" }} />',
      'export const Probe = () => <div style={{ background: `hsl(160 70% 40%)` }} />',
      'const css = `.cell { border-color: #e5e5e5; }`; export const Probe = () => <style>{css}</style>',
    ]) {
      expect(await restrictions(source), source).toHaveLength(1);
    }
    for (const source of [
      'export const Probe = () => <div className="bg-calendar-today border-calendar-grid" />',
      'export const Probe = () => <a href={`#planning-warning-reason`} />',
    ]) {
      expect(await restrictions(source), source).toHaveLength(0);
    }
  });

  test('rejects a hand-built full-screen frame outside StandaloneScreen', async () => {
    expect(
      await restrictions(
        'export const Probe = () => <main className="flex min-h-dvh flex-col items-center justify-center px-4" />',
      ),
    ).toHaveLength(1);
    expect(
      await restrictions(
        'export const Probe = () => <main className="flex min-h-dvh flex-col items-center justify-center px-4" />',
        'components/shared/standalone-screen.tsx',
      ),
    ).toHaveLength(0);
  });

  test('rejects a stored date rendered as text', async () => {
    for (const source of [
      'export const Probe = () => <p>ab {record.validFrom}</p>',
      'export const Probe = () => <p>{conflict.localDate ? ` (${conflict.localDate})` : ""}</p>',
      'export const Probe = () => <p>{record.validUntil ? " bis " + record.validUntil : ""}</p>',
    ]) {
      expect(await restrictions(source), source).toHaveLength(1);
    }
    expect(
      await restrictions('export const Probe = () => <p>ab {formatGermanDate(record.validFrom)}</p>'),
    ).toHaveLength(0);
  });

  test('rejects a hand-written detail card title', async () => {
    expect(
      await restrictions(
        'export const Probe = () => <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Profil</h3>',
      ),
    ).toHaveLength(1);
  });

  test('rejects the page title style on an h2', async () => {
    expect(
      await restrictions(
        'export const Probe = () => <h2 className="text-xl font-semibold tracking-tight">Zeitkonto</h2>',
      ),
    ).toHaveLength(1);
    expect(
      await restrictions('export const Probe = () => <h2 className="text-lg font-semibold">Zeitkonto</h2>'),
    ).toHaveLength(0);
  });

  test('reserves the search magnifier for SearchInput', async () => {
    expect(
      await restrictions(
        'import { Search } from "lucide-react"; export const Probe = () => <div><Search /><Input /></div>',
      ),
    ).toHaveLength(1);
    expect(
      await restrictions('import { SearchX } from "lucide-react"; export const Probe = () => <SearchX />'),
    ).toHaveLength(0);
  });

  test('reserves fixed positioning for the named floating layers', async () => {
    for (const source of [
      'export const Probe = () => <Button className="fixed bottom-6 right-6 md:hidden" />',
      'export const Probe = () => <div className={`max-sm:fixed inset-0 ${tone}`} />',
    ]) {
      expect(await restrictions(source), source).toHaveLength(1);
    }
    expect(
      await restrictions('export const Probe = () => <div className="table-fixed sticky top-0" />'),
    ).toHaveLength(0);
    expect(
      await restrictions(
        'export const Probe = () => <div className="fixed inset-0" />',
        'components/clock-fab.tsx',
      ),
    ).toHaveLength(0);
  });

  test('requires Field even when a label/input stack already has spacing', async () => {
    expect(
      await restrictions(
        'export const Probe = () => <div className="grid gap-2"><Label>Name</Label><Input /></div>',
      ),
    ).toHaveLength(1);
  });

  test('rejects conditional, fragment, and nested controls beside a raw Label', async () => {
    for (const control of [
      '{visible && <Input />}',
      '{visible ? <Input /> : <Textarea />}',
      '<><Input /></>',
      '<div><Input /></div>',
    ]) {
      expect(
        await restrictions(
          `export const Probe = () => <div className="grid gap-2"><Label>Name</Label>${control}</div>`,
        ),
      ).toHaveLength(1);
    }
  });

  test('respects Field ownership and standalone or checkbox labels', async () => {
    for (const source of [
      '<Field label="Name"><div><Label>Zusatz</Label><Input /></div></Field>',
      '<div className="space-y-2"><Label>Abschnitt</Label><Field label="Name"><Input /></Field></div>',
      '<div className="flex items-center gap-2"><Checkbox /><Label>Aktiv</Label></div>',
    ])
      expect(await restrictions(`export const Probe = () => ${source}`)).toHaveLength(0);
  });

  for (const path of [
    'components/realtime/realtime-provider.tsx',
    'components/shared/page-shell.tsx',
    'app/reset-password/reset-password-form.tsx',
    'hooks/use-business-day-refresh.ts',
  ]) {
    test(`${path} keeps the unrelated transition restriction`, async () => {
      expect(
        await restrictions(
          'import {useTransition} from "react"; export function Probe(){ return useTransition(); }',
          path,
        ),
      ).toHaveLength(1);
    });
  }

  test('named transition owners still reject native inputs and global sign-out', async () => {
    for (const path of [
      'components/organization/organization-context.tsx',
      'components/dokumente/document-library-content.tsx',
    ]) {
      expect(
        await restrictions(
          'export function Probe(){ client.auth.signOut(); return <input type={"date"}/>; }',
          path,
        ),
      ).toHaveLength(2);
    }
  });

  test("rejects a Lucide strokeWidth prop but not an SVG primitive's", async () => {
    const [icon] = await eslint.lintText(
      'import { Check } from "lucide-react"; export const Probe = () => <Check strokeWidth={3} />;',
      { filePath: 'components/ui-contract-probe.tsx' },
    );
    expect(icon.messages.map(({ ruleId }) => ruleId)).toContain('ui/no-lucide-stroke-width');
    const [circle] = await eslint.lintText(
      'export const Probe = () => <svg><circle strokeWidth={3} /></svg>;',
      { filePath: 'components/ui-contract-probe.tsx' },
    );
    expect(circle.messages.map(({ ruleId }) => ruleId)).not.toContain('ui/no-lucide-stroke-width');
  });

  test('rejects numbered palette classes in product JSX but not the semantic tokens', async () => {
    expect(
      await restrictions(
        'export const Probe = () => <span className="bg-green-100 text-green-800 dark:text-green-300" />',
      ),
    ).toHaveLength(1);
    expect(
      await restrictions(
        'export const Probe = () => <span className={`rounded ${active ? "text-yellow-700" : ""}`} />',
      ),
    ).toHaveLength(1);
    expect(
      await restrictions(
        'export const Probe = () => <span className="bg-success-soft text-success-soft-foreground border-warning/40 text-destructive bg-muted" />',
      ),
    ).toHaveLength(0);
  });

  test('requires explicit boundary types under lib but not in components', async () => {
    const source = 'export function probe(value) { return value; }';
    const [library] = await eslint.lintText(source, { filePath: 'lib/boundary-probe.ts' });
    expect(library.messages.map(({ ruleId }) => ruleId)).toContain(
      '@typescript-eslint/explicit-module-boundary-types',
    );
    const [component] = await eslint.lintText(source, { filePath: 'components/boundary-probe.ts' });
    expect(component.messages.map(({ ruleId }) => ruleId)).not.toContain(
      '@typescript-eslint/explicit-module-boundary-types',
    );
  });

  test('rejects ring offsets in product JSX', async () => {
    expect(
      await restrictions('export const Probe = () => <div className="focus:ring-2 focus:ring-offset-1" />'),
    ).toHaveLength(1);
  });

  test('requires a reason on every lint suppression and rejects stale ones', async () => {
    const [reasonless] = await eslint.lintText(
      '// eslint-disable-next-line no-console\nconsole.log("x");\n',
      { filePath: 'components/comment-probe.ts' },
    );
    expect(reasonless.messages.map(({ ruleId }) => ruleId)).toContain(
      '@eslint-community/eslint-comments/require-description',
    );
    const [stale] = await eslint.lintText(
      '// eslint-disable-next-line no-console -- nothing to suppress here\nexport const value = 1;\n',
      { filePath: 'components/comment-probe.ts' },
    );
    expect(stale.messages.some(({ message }) => message.includes('Unused eslint-disable directive'))).toBe(
      true,
    );
    const [reasoned] = await eslint.lintText(
      '// eslint-disable-next-line no-console, no-restricted-properties -- deliberate diagnostic\nconsole.log("x");\n',
      { filePath: 'components/comment-probe.ts' },
    );
    expect(reasoned.messages).toHaveLength(0);
  });

  test('product code logs only through lib/logging.ts', async () => {
    for (const filePath of [
      'lib/probe.ts',
      'components/probe.tsx',
      'hooks/use-probe.ts',
      'app/(app)/probe/page.tsx',
      'app/api/probe/route.ts',
      'app/auth/probe/route.ts',
      'proxy.ts',
    ]) {
      const [raw] = await eslint.lintText(
        'export function f(error: unknown) { console.error("x", error); }\n',
        {
          filePath,
        },
      );
      expect(
        raw.messages.map(({ ruleId }) => ruleId),
        filePath,
      ).toContain('no-restricted-properties');
    }
    const [helper] = await eslint.lintText(
      "import { logError } from '@/lib/logging';\nexport function f(error: unknown) { logError('x', error); }\n",
      { filePath: 'lib/probe.ts' },
    );
    expect(helper.messages.filter(({ ruleId }) => ruleId === 'no-restricted-properties')).toEqual([]);
  });

  test('a submit button is disabled only on pending or availability flags', async () => {
    for (const expression of [
      'isSaving || reason.trim().length < 3',
      'pending || !selectedId',
      '!isValid || isLoading',
      "busy.isBusy('state') || !workTargetId",
    ]) {
      expect(
        await restrictions(
          `export const Probe = () => <Button type="submit" disabled={${expression}}>Speichern</Button>`,
        ),
        expression,
      ).toHaveLength(1);
    }
    for (const expression of [
      'isSaving',
      'isPending || optionBusy.anyBusy',
      "busy.isBusy('state')",
      '!canEdit || isSaving || !form.formState.isDirty',
      'formDisabled',
    ]) {
      expect(
        await restrictions(
          `export const Probe = () => <Button type="submit" disabled={${expression}}>Speichern</Button>`,
        ),
        expression,
      ).toHaveLength(0);
    }
  });

  test('a local condition behind a disabled flag is judged by what it computes', async () => {
    const probe = (body, disabled, attributes = 'type="submit"') =>
      `export function Probe({ submitting, isSaving, isUploading, reason, role, statusIntent, selectedIds, selectedRegion, initialRegion }) { ${body} return <Button ${attributes} disabled={${disabled}}>Speichern</Button>; }`;
    for (const [body, disabled] of [
      ['', 'submitting || validationCheck'],
      ['const submitDisabled = submitting || reason.trim().length < 8;', 'submitDisabled'],
      [
        'const statusDisabled = statusIntent !== null && reason.trim().length < 8;',
        'submitting || statusDisabled',
      ],
      ['const blocked = isSaving || reasonMissing;', 'blocked'],
    ]) {
      expect(
        (await restrictions(probe(body, disabled))).map(({ ruleId }) => ruleId),
        `${body} ${disabled}`,
      ).toEqual(['ui/submit-disabled-only-while-pending']);
    }
    for (const [body, disabled] of [
      ['const submitDisabled = isSaving || isUploading;', 'submitDisabled'],
      ["const canEdit = role === 'admin';", '!canEdit || isSaving'],
      ['const { formDisabled } = props;', 'formDisabled'],
    ]) {
      expect(await restrictions(probe(body, disabled)), `${body} ${disabled}`).toHaveLength(0);
    }
    for (const [body, disabled] of [
      ['const validationCheck = !reason.trim();', 'submitting || validationCheck'],
      ['const linkDisabled = isSaving || selectedIds.size === 0;', 'linkDisabled'],
    ]) {
      expect(
        (await restrictions(probe(body, disabled, 'onClick={save}'))).map(({ ruleId }) => ruleId),
        `${body} ${disabled}`,
      ).toEqual(['ui/action-disabled-only-while-pending']);
    }
    expect(
      await restrictions(
        probe(
          'const regionDirty = selectedRegion !== initialRegion;',
          'isSaving || !regionDirty',
          'onClick={save}',
        ),
      ),
    ).toHaveLength(0);
  });

  test('no file switches off the disabled-button rules; an exception is an inline disable with its reason', async () => {
    const { default: config } = await import('../../eslint.config.mjs');
    for (const block of config) {
      for (const rule of ['ui/submit-disabled-only-while-pending', 'ui/action-disabled-only-while-pending']) {
        const setting = block.rules?.[rule];
        if (setting === undefined) continue;
        expect([setting].flat()[0], `${rule} in ${JSON.stringify(block.files)}`).toBe('error');
      }
    }
  });

  test('a Boolean() wrapper names the flag it coerces', async () => {
    const [selection] = await restrictions(
      'export const Probe = () => <Button type="submit" disabled={Boolean(selectedId)}>Speichern</Button>',
    );
    expect(selection?.ruleId).toBe('ui/submit-disabled-only-while-pending');
    expect(selection?.message).toContain('`selectedId`');
    expect(
      await restrictions(
        'export const Probe = () => <Button type="submit" disabled={Boolean(isSaving)}>Speichern</Button>',
      ),
    ).toHaveLength(0);
  });

  test('an action button is disabled only while pending, never on a missing choice or text', async () => {
    for (const expression of [
      'isSaving || !selectedProjectId',
      'isPending || selectedDocumentIds.size === 0',
      'extending || reason.trim().length < 8',
      '!editingTeamName.trim() || pendingAction !== null',
      '!form.selectedId',
    ]) {
      const messages = await restrictions(
        `export const Probe = () => <Button onClick={save} disabled={${expression}}>Speichern</Button>`,
      );
      expect(
        messages.map(({ ruleId }) => ruleId),
        expression,
      ).toEqual(['ui/action-disabled-only-while-pending']);
    }
    for (const expression of [
      'isSaving',
      'anyBusy || Boolean(loadError)',
      'busy || page >= lastPage',
      'isBusy || !canRestore',
      'isPending || !hasChanges',
    ]) {
      expect(
        await restrictions(
          `export const Probe = () => <Button onClick={save} disabled={${expression}}>Speichern</Button>`,
        ),
        expression,
      ).toHaveLength(0);
    }
    // A submit button is the submit rule's alone, so it is reported once.
    expect(
      (
        await restrictions(
          'export const Probe = () => <Button type="submit" disabled={!selectedId}>Speichern</Button>',
        )
      ).map(({ ruleId }) => ruleId),
    ).toEqual(['ui/submit-disabled-only-while-pending']);
  });

  test('an icon button is named only by a non-empty aria-label, never by a spread', async () => {
    for (const source of [
      '<Button size="icon" aria-label=""><X /></Button>',
      '<Button size="icon" aria-label=" "><X /></Button>',
      '<Button size="icon" aria-label><X /></Button>',
      '<Button size="icon" {...triggerProps}><X /></Button>',
    ]) {
      expect(await restrictions(`export const Probe = () => ${source}`), source).toHaveLength(1);
    }
    for (const source of [
      '<Button size="icon" aria-label={label}><X /></Button>',
      '<Button size="icon-sm" aria-labelledby="title-id"><X /></Button>',
    ]) {
      expect(await restrictions(`export const Probe = () => ${source}`), source).toHaveLength(0);
    }
  });

  test('a pending flag set before an await is reset on the failure path too', async () => {
    for (const body of [
      'setIsSaving(true); const result = await save(); setIsSaving(false); return result;',
      'setBusy(true); try { await save(); } catch (error) { report(error); } await reload(); setBusy(false);',
      'setIsDeleting(true); await save(); if (failed) { setIsDeleting(false); }',
    ]) {
      const messages = await restrictions(`export function useProbe() { return async () => { ${body} }; }`);
      expect(
        messages.map(({ ruleId }) => ruleId),
        body,
      ).toEqual(['ui/pending-reset-on-failure']);
    }
    for (const body of [
      'setIsSaving(true); try { await save(); } finally { setIsSaving(false); }',
      'setIsSaving(true); try { await save(); } catch { setIsSaving(false); return; } setIsSaving(false);',
      'setIsSaving(true); await save().catch(report); setIsSaving(false);',
      'setIsSaving(true); try { await save(); } finally { setIsSaving(false); } await reload();',
      'setIsOpen(true); await save(); setIsOpen(false);',
      'void busy.run(id, async () => { setIsLoading(true); await read(); setIsLoading(false); }).catch(() => setIsLoading(false));',
    ]) {
      expect(
        await restrictions(
          `export function useProbe() { return async () => { ${body} }; }`,
          'hooks/use-probe.ts',
        ),
        body,
      ).toHaveLength(0);
    }
  });

  test('a page-wide bubble-phase keydown listener skips a consumed key', async () => {
    for (const body of [
      "const onKey = (event) => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', onKey);",
      "window.addEventListener('keydown', (event) => { if (event.key === 'c') create(); });",
      "function onKey(event) { if (event.key === 'Escape') close(); } window.addEventListener('keydown', onKey, { capture: false });",
    ]) {
      expect(
        (
          await restrictions(
            `export function useProbe() { useEffect(() => { ${body} }, []); }`,
            'hooks/use-probe.ts',
          )
        ).map(({ ruleId }) => ruleId),
        body,
      ).toEqual(['ui/global-key-handler-respects-consumed']);
    }
    for (const body of [
      "const onKey = (event) => { if (event.key === 'Escape' && !event.defaultPrevented) close(); }; document.addEventListener('keydown', onKey);",
      "window.addEventListener('keydown', (event) => { event.preventDefault(); cancel(); }, { capture: true });",
      "window.addEventListener('keyup', (event) => setFine(event.shiftKey));",
      "element.addEventListener('keydown', (event) => close());",
    ]) {
      expect(
        await restrictions(
          `export function useProbe() { useEffect(() => { ${body} }, []); }`,
          'hooks/use-probe.ts',
        ),
        body,
      ).toHaveLength(0);
    }
  });

  test('an empty static input type counts as a raw text input', async () => {
    for (const source of ['<input type="" />', '<input type={""} />']) {
      expect(
        (await restrictions(`export const Probe = () => ${source}`)).map(({ ruleId }) => ruleId),
        source,
      ).toEqual(['ui/no-raw-controls']);
    }
  });

  test('rejects raw buttons, raw text inputs, unnamed icon buttons, a second h1 and dialog width classes', async () => {
    for (const source of [
      '<button onClick={close}>Schließen</button>',
      '<input value={query} onChange={change} />',
      '<input type="text" />',
      '<Button size="icon"><X /></Button>',
      '<h1>Dokumente</h1>',
      '<DialogContent className="sm:max-w-[425px]" />',
      '<DialogContent className="overflow-visible max-w-2xl" />',
    ]) {
      expect(await restrictions(`export const Probe = () => ${source}`), source).toHaveLength(1);
    }
    for (const source of [
      '<PlainButton onClick={close}>Schließen</PlainButton>',
      '<input type="file" />',
      '<input type="hidden" name="id" value={id} />',
      '<Button size="icon" aria-label="Schließen"><X /></Button>',
      '<Button size="icon"><X /><span className="sr-only">Schließen</span></Button>',
      '<DialogContent size="md" className="overflow-visible" />',
      '<DialogContent className="!max-w-none sm:!max-w-none" />',
    ]) {
      expect(await restrictions(`export const Probe = () => ${source}`), source).toHaveLength(0);
    }
    expect(
      await restrictions('export const Probe = () => <h1>Titel</h1>', 'components/shared/page-header.tsx'),
    ).toHaveLength(0);
  });

  test('rejects a block element inside a paragraph, also through conditions and maps', async () => {
    for (const source of [
      '<p>Lädt <Skeleton className="h-4 w-20" /></p>',
      '<p>{loading ? <div /> : text}</p>',
      '<p>{items.map((item) => <span key={item}><div /></span>)}</p>',
      '<p className="text-sm"><ErrorText>Fehler</ErrorText></p>',
      '<p><p>Innen</p></p>',
    ]) {
      expect(await restrictions(`export const Probe = () => ${source}`), source).toHaveLength(1);
    }
    for (const source of [
      '<p>Text <span className="font-medium">fett</span></p>',
      '<div><p>Absatz</p><Skeleton /></div>',
      '<p title={<div />}>Text</p>',
      '<div><p>Absatz</p><div><ul /></div></div>',
    ]) {
      expect(await restrictions(`export const Probe = () => ${source}`), source).toHaveLength(0);
    }
  });

  test('rejects a swallowed rejection in product code and keeps the handled shapes', async () => {
    for (const source of [
      'export const probe = () => { void load().catch(() => {}); };',
      'export const probe = () => { void load().catch(() => { return; }); };',
      'export const probe = () => load().catch(() => undefined);',
      'export const probe = async () => { await load().catch((error) => void 0); };',
      'export const probe = async () => { const result = await load().catch(() => ({})); return result; };',
      'export const probe = async () => { await load().catch(() => null); };',
      'export const probe = () => { void load().catch(() => null); };',
      'export const probe = () => load().catch(() => null);',
    ]) {
      expect(await restrictions(source, 'lib/swallow-probe.ts'), source).toHaveLength(1);
    }
    for (const source of [
      'export const probe = async () => { const result = await load().catch(() => null); return result?.success ?? false; };',
      'export const probe = () => { const pending = load().catch(() => null); return pending; };',
      'export const probe = () => load().catch((error) => { console.error(error); });',
      'export const probe = () => load().catch(() => ({ success: false }));',
      'export const probe = () => load().catch(report);',
    ]) {
      expect(await restrictions(source, 'lib/swallow-probe.ts'), source).toHaveLength(0);
    }
  });

  test('a dialog root that waits for a request takes pending instead of a hand-written guard', async () => {
    const ruleIds = async (source) =>
      (await restrictions(source))
        .map(({ ruleId }) => ruleId)
        .filter((id) => id === 'ui/dialog-pending-while-waiting');
    for (const source of [
      'export const Probe = () => <Dialog open onOpenChange={(open) => !open && !isSaving && onClose()}><DialogContent /></Dialog>;',
      'export function Probe() { function change(next) { if (!isPending) setOpen(next); } return <Dialog open={open} onOpenChange={change} />; }',
      'export const Probe = () => <AlertDialog open={open} onOpenChange={(open) => { if (!open && !isDissolving) close(); }} />;',
      'export const Probe = () => <Dialog open={open} onOpenChange={setOpen}><DialogFooter><Button type="submit" disabled={isSaving}>Speichern</Button></DialogFooter></Dialog>;',
      'export function Probe() { const busy = link.isPending || link.isSettling; return <Dialog open={open} onOpenChange={setOpen}><Button onClick={save} disabled={busy}>Speichern</Button></Dialog>; }',
      'export const Probe = () => <AlertDialog open={open} onOpenChange={setOpen}><AlertDialogAction onClick={async (event) => { event.preventDefault(); await remove(); }}>Löschen</AlertDialogAction></AlertDialog>;',
    ]) {
      expect(await ruleIds(source), source).toEqual(['ui/dialog-pending-while-waiting']);
    }
    for (const source of [
      'export const Probe = () => <Dialog open onOpenChange={(open) => !open && onClose()} pending={isSaving}><Button type="submit" disabled={isSaving}>Speichern</Button></Dialog>;',
      // A read that loads options does not block the close.
      'export const Probe = () => <Dialog open={open} onOpenChange={setOpen}><Button onClick={pick} disabled={isLoading || previewPending}>Übernehmen</Button></Dialog>;',
      // A handler passed in by the parent is not a guard this file can see.
      'export function Probe({ onOpenChange }) { return <Dialog open={open} onOpenChange={onOpenChange} />; }',
      // Writing a deferred choice is no read of a pending flag.
      'export const Probe = () => <AlertDialog open={open} onOpenChange={(open) => { if (!open) setPendingSaveConfirmation(null); }} />;',
      // An uncontrolled confirmation that closes at once; the trigger spins for the request.
      'export const Probe = () => <AlertDialog><AlertDialogTrigger asChild><Button disabled={isPending}>Löschen</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogAction onClick={remove}>Löschen</AlertDialogAction></AlertDialogContent></AlertDialog>;',
      // A nested dialog answers for its own controls.
      'export const Probe = () => <Dialog open={open} onOpenChange={setOpen}><Dialog open={inner} onOpenChange={setInner} pending={isSaving}><Button disabled={isSaving}>Speichern</Button></Dialog></Dialog>;',
    ]) {
      expect(await ruleIds(source), source).toEqual([]);
    }
  });

  test('an effect that only copies props or state into state is reported', async () => {
    const ruleIds = async (source) =>
      (await restrictions(source, 'hooks/use-probe.ts'))
        .map(({ ruleId }) => ruleId)
        .filter((id) => id === 'ui/no-derived-state-effect');
    const hook = (body) =>
      `import { useEffect, useRef, useState } from 'react'; export function useProbe(job, open) { const [live, setLive] = useState(job); const [draft, setDraft] = useState(''); const ref = useRef(null); ${body} return [live, draft, ref]; }`;
    for (const body of [
      'useEffect(() => { setLive(job); }, [job]);',
      'useEffect(() => setLive(job), [job]);',
      'useEffect(() => { setLive(job); setDraft(job.title ?? ""); }, [job]);',
      'useEffect(() => { if (!open) return; setDraft(job.title); }, [open, job.title]);',
      'useEffect(() => { if (open) { setDraft(""); setLive(job); } }, [open, job]);',
      'useEffect(() => { setLive((current) => ({ ...current, ...job })); }, [job]);',
    ]) {
      expect(await ruleIds(hook(body)), body).toEqual(['ui/no-derived-state-effect']);
    }
    for (const body of [
      // A constant reset is react-hooks/set-state-in-effect's to report.
      'useEffect(() => { setDraft(""); }, [open]);',
      // A ref read, an external read and async work are what an effect is for.
      'useEffect(() => { setDraft(ref.current); }, [open]);',
      'useEffect(() => { setDraft(window.localStorage.getItem("draft") ?? ""); }, []);',
      'useEffect(() => { void load(job.id).then(setLive); }, [job.id]);',
      'useEffect(() => { const timer = setTimeout(() => setDraft(job.title), 10); return () => clearTimeout(timer); }, [job]);',
      'useEffect(() => { setLive(job); track(job.id); }, [job]);',
      // Adoption during render is the fix.
      'const [adopted, setAdopted] = useState(job); if (job !== adopted) { setAdopted(job); setLive(job); }',
    ]) {
      expect(await ruleIds(hook(body)), body).toEqual([]);
    }
  });

  test('a catch surfaces its failure or names its best effort', async () => {
    const silentCatches = async (body, filePath = 'lib/probe.ts') => {
      const [result] = await eslint.lintText(
        `import { logError } from '@/lib/logging';\nexport async function probe(work: () => Promise<number>) { ${body} }\n`,
        { filePath },
      );
      return result.messages.filter(({ ruleId }) => ruleId === 'quality/no-silent-catch');
    };
    // The planted violation: the clock-out failure of the old sign-out vanished in the log.
    const planted = await silentCatches(
      "try { await work(); } catch (error) { logError('auth.sign_out.clock_out_failed', error); }",
    );
    expect(planted).toHaveLength(1);
    expect(planted[0]?.line).toBe(2);
    for (const filePath of [
      'components/probe.tsx',
      'hooks/use-probe.ts',
      'app/api/probe/route.ts',
      'proxy.ts',
    ]) {
      expect(await silentCatches('try { await work(); } catch {}', filePath), filePath).toHaveLength(1);
    }
    for (const body of [
      'try { await work(); } catch {}',
      'try { await work(); } catch { return; }',
      'try { return await work(); } catch { return undefined; }',
      'try { await work(); } catch { return []; }',
      'try { await work(); } catch { return {}; }',
      "try { await work(); } catch (error) { logError('x', error); return; }",
      '// best-effort: a comment outside the block does not count\ntry { await work(); } catch {}',
      'try { await work(); } catch {\n// best-effort:\n}',
    ]) {
      expect(await silentCatches(body), body).toHaveLength(1);
    }
    for (const body of [
      "try { await work(); } catch (error) {\n// best-effort: the main outcome already succeeded.\nlogError('x', error); }",
      'try { return await work(); } catch { return null; }',
      'try { await work(); } catch (error) { throw new Error("refused", { cause: error }); }',
      "try { await work(); } catch { return { success: false, error: 'unexpected_error' }; }",
      "try { await work(); } catch (error) { logError('x', error); setError('failed'); }",
    ]) {
      expect(await silentCatches(body), body).toEqual([]);
    }
    expect(await silentCatches('try { await work(); } catch {}', 'lib/probe.test.ts')).toEqual([]);
  });

  test('registered controls and named transition owner remain usable', async () => {
    expect(
      await restrictions('export const Probe = () => <Field label="Name"><Input /></Field>'),
    ).toHaveLength(0);
    expect(
      await restrictions(
        'import {useTransition} from "react"; export function Probe(){return useTransition();}',
        'components/ui/refresh-button.tsx',
      ),
    ).toHaveLength(0);
  });
});
