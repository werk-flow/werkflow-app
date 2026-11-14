import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// EmptyState has two titles (components/ui/empty-state.tsx): an empty source
// says „Noch keine …“, a search or filter without a match says „Keine …
// gefunden“. The Arbeitsvorlagen list opened with a call to action as its
// title instead (rendered review of 2026-10-02). A prompt that asks for an
// input before anything can show is a named exception.

const root = resolve(import.meta.dir, '../..');
const PROMPT_TITLES = new Set(['Zeitraum wählen']);
const CANON_TITLE = /^(Noch kein|Kein)/;

const productSources: ReadonlyArray<{ file: string; text: string }> = ['app', 'components'].flatMap(
  (directory) =>
    readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })
      .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') })),
);

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

test('a literal EmptyState title follows the two canon patterns', () => {
  const offenders: string[] = [];
  for (const { file, text } of productSources) {
    if (!text.includes('<EmptyState')) continue;
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText() === 'EmptyState'
      ) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || attribute.name.getText() !== 'title') continue;
          // `title={'…'}` is the same literal as `title="…"`.
          const initializer = attribute.initializer;
          const value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
          if (!value || !(ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) continue;
          if (!CANON_TITLE.test(value.text) && !PROMPT_TITLES.has(value.text))
            offenders.push(`${file}: ${value.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file, text));
  }
  expect(offenders).toEqual([]);
});

// Census (Tier 2): an empty list or region renders through EmptyState, a
// block where the rows would be or `size="compact"` inside a card section.
// About 90 hand-written „Noch keine …“ and „Keine …“ notes once rendered as
// plain paragraphs (UI audit of 2026-10-17). A text that starts like an empty
// state and renders as a JSX child outside an EmptyState fails. The position
// in the syntax tree exempts what is no empty state: every attribute value
// (EmptyState's own `title` and `description`, a `placeholder`, a select's
// `emptyMessage`, an `aria-label`) and every string passed to a function (a
// message). A sentence that stays a child although it reads like an empty
// state is listed below with its reason; the list only shrinks.

/** File and text of a sentence that reads like an empty state but is none, with the reason. */
const REVIEWED_SENTENCES: Readonly<Record<string, string>> = {
  'app/(auth)/login/page.tsx: Noch kein Konto?': 'a prompt before the sign-up link',
  'components/anfragen/request-customer-card.tsx: Noch keinem Kunden zugeordnet.':
    'the state of the request’s customer field',
  'components/arbeitsvorlagen/work-templates-content.tsx: Keine Beschreibung': 'a field value placeholder',
  'components/auftraege/handover/work-handover-release-review.tsx: Keine laufende Zeiterfassung':
    'one count of the handover check, beside its siblings',
  'components/auftraege/handover/work-handover-release-review.tsx: Keine offene Ausnahme':
    'one count of the handover check, beside its siblings',
  'components/auftraege/job-detail/job-detail-time-card.tsx: Kein geplanter Arbeitsaufwand hinterlegt.':
    'a field value placeholder for the planned effort',
  'components/auftraege/job-detail/job-qualification-coverage-list.tsx: Keine passende Person zugewiesen':
    'a fact inside one requirement row',
  'components/auftraege/job-detail/use-job-detail-metadata-fields.tsx: Keine Beschreibung':
    'a field value placeholder',
  'components/auftraege/lifecycle/work-lifecycle-blockers-section.tsx: Kein nächster Schritt beschrieben.':
    'a field value placeholder inside one blocker',
  'components/auftraege/project-detail/project-detail-metadata-fields.tsx: Keine Beschreibung':
    'a field value placeholder',
  'components/auftraege/project-detail/project-detail-time-summary-card.tsx: Kein geplanter Arbeitsaufwand hinterlegt.':
    'a field value placeholder for the planned effort',
  'components/auftraege/work-pack/field-work-pack-overview.tsx: Keine Adresse hinterlegt':
    'a field value placeholder',
  'components/inventar/job-material-item-picker.tsx: Noch keinem Lager zugeordnet':
    'a fact inside one picker option',
  'components/kalender/calendar-view-tabs.tsx: Keine auswählen': 'a button label',
  'components/kalender/dispatch-panel-batch.tsx: Keine Konflikte, Bestätigungen oder Zusagen betroffen.':
    'a fact inside the batch preview list',
  'components/kalender/dispatch-panel-occurrences.tsx: Keine Personen zugewiesen – zuerst im Kalender zuweisen.':
    'a hint inside one planned visit',
  'components/mitarbeiter/personnel-lifecycle-onboarding-dialogs.tsx: Keine veröffentlichte Vorlage. Der Plan startet leer.':
    'a hint below a dialog field',
  'components/mitarbeiter/personnel-lifecycle-overview.tsx: Noch keine kontrollierte Zugangsregel. Bestehender Mitgliedszugang bleibt unverändert.':
    'the state of the access field',
  'components/mitarbeiter/personnel-own-actions-section.tsx: Keine Diagnose oder medizinischen Details in WerkFlow erfassen.':
    'an instruction below an upload field',
  'components/service/maintenance-lists.tsx: Keine Referenz':
    'a field value placeholder inside one coverage row',
  'components/zeiterfassung/pending-approvals-header.tsx: Keine ausstehenden Anträge':
    'the count in the header; the list below renders its own EmptyState',
  'components/zeiterfassung/vacation-approvals-cards.tsx: Kein Urlaubsanspruch hinterlegt – Anspruch in der Personalakte unter Beschäftigung pflegen.':
    'a warning about one request’s missing entitlement',
  'components/zeiterfassung/vacation-section-balance.tsx: Keine offenen Anträge':
    'a fact in the balance summary',
  'components/zeiterfassung/vacation-section-balance.tsx: Kein Urlaubsanspruch hinterlegt. Der Anspruch wird vom Büro in den Beschäftigungs&shy;konditionen gepflegt; Anträge sind trotzdem möglich.':
    'the state of the entitlement field',
};

/** JSX nodes and expressions a rendered child passes on its way up to its element. */
function isRenderPassThrough(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxFragment(node) ||
    ts.isJsxExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isConditionalExpression(node) ||
    ts.isBinaryExpression(node)
  );
}

/** Whether a text node renders as a JSX child, outside any attribute value. */
function rendersAsChild(node: ts.Node): boolean {
  let reachedElement = ts.isJsxText(node);
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return false;
    if (!isRenderPassThrough(current)) return reachedElement;
    if (ts.isJsxElement(current) || ts.isJsxFragment(current)) reachedElement = true;
  }
  return reachedElement;
}

function textOf(node: ts.Node): string | undefined {
  if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text.replace(/\s+/g, ' ').trim();
  if (ts.isTemplateExpression(node)) return node.head.text.trim();
  return undefined;
}

/** `file: text` of every child text that reads like an empty state. */
function plainEmptyTexts(file: string, text: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    const value = textOf(node);
    if (value && CANON_TITLE.test(value) && rendersAsChild(node)) found.add(`${file}: ${value}`);
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return [...found];
}

function censusProblems(
  sources: ReadonlyArray<{ file: string; text: string }>,
  reviewed: Readonly<Record<string, string>>,
): { unreviewed: string[]; stale: string[] } {
  const found = sources.flatMap(({ file, text }) => plainEmptyTexts(file, text));
  return {
    unreviewed: found.filter((site) => !Object.hasOwn(reviewed, site)),
    stale: Object.keys(reviewed).filter((site) => !found.includes(site)),
  };
}

describe('empty-state census', () => {
  test('every empty list or region renders through EmptyState', () => {
    expect(censusProblems(productSources, REVIEWED_SENTENCES).unreviewed).toEqual([]);
  });

  test('every reviewed sentence still exists', () => {
    expect(censusProblems(productSources, REVIEWED_SENTENCES).stale).toEqual([]);
  });

  test('every reviewed sentence names its reason', () => {
    expect(Object.entries(REVIEWED_SENTENCES).filter(([, reason]) => reason.trim() === '')).toEqual([]);
  });

  const probe = (text: string): string[] => plainEmptyTexts('probe.tsx', text);

  test('probe: a plain paragraph fails, as text or as a branch of a condition', () => {
    expect(probe('const a = <p>Noch keine Einträge.</p>;')).toEqual(['probe.tsx: Noch keine Einträge.']);
    expect(probe("const a = <p>{rows.length ? null : 'Keine Treffer gefunden'}</p>;")).toEqual([
      'probe.tsx: Keine Treffer gefunden',
    ]);
    expect(probe('const a = rows.map(() => <li>Keine Angabe</li>);')).toEqual(['probe.tsx: Keine Angabe']);
  });

  test('probe: the same text as an EmptyState title or description passes', () => {
    expect(probe('const a = <EmptyState title="Noch keine Einträge." />;')).toEqual([]);
    expect(probe('const a = <EmptyState size="compact" title={x ? "Kein A" : "Kein B"} />;')).toEqual([]);
    expect(probe('const a = <EmptyState title="X" description={<>Noch keine Vorlage.</>} />;')).toEqual([]);
  });

  test('probe: attribute values and messages pass', () => {
    expect(probe('const a = <Input placeholder="Keine Angabe" />;')).toEqual([]);
    expect(probe('const a = <SearchableSelect emptyMessage="Keine Ergebnisse" />;')).toEqual([]);
    expect(probe("showBanner({ message: describe('Keine Änderungen vorgenommen.') });")).toEqual([]);
    expect(probe("const label = 'Kein Kunde';")).toEqual([]);
  });

  test('probe: a reviewed sentence that no longer exists is stale', () => {
    const sources = [{ file: 'probe.tsx', text: 'const a = <p>Keine Referenz</p>;' }];
    expect(censusProblems(sources, { 'probe.tsx: Keine Referenz': 'placeholder' })).toEqual({
      unreviewed: [],
      stale: [],
    });
    expect(
      censusProblems(sources, { 'probe.tsx: Keine Referenz': 'x', 'gone.tsx: Kein Eintrag': 'x' }),
    ).toEqual({
      unreviewed: [],
      stale: ['gone.tsx: Kein Eintrag'],
    });
  });
});
