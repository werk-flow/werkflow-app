// Rule test: a form that marks its fields focuses the first one through focusFirstInvalidField.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { listProductSources, parseProductSource } from './product-sources';

// Tier 2 for "a submit with missing input marks the fields and focuses the
// first" (AGENTS.md "1. UI and UX", design canon "Forms and Enter"). The Tier 1
// owner is `focusFirstInvalidField` (lib/ui/field-validation.ts): it takes the
// error map keyed by control id in visual order and focuses the first invalid
// control. Lint (`validationFocusSelectors`) rejects a hand-written
// `getElementById(...).focus()`; this census finds the forms that mark fields
// and focus nothing, or focus by hand. About seventy validation paths did one
// or the other before the UI audit of 2026-10-17.
//
// A module marks its fields when it
//   (a) writes a field-error state: it calls, with a non-empty value, the
//       setter of a local `useState` whose value is named `*Error` or
//       `*Errors` (the submit-level `error` and the failure names below
//       excepted), or
//   (b) records the submit attempt that reveals derived field errors:
//       `setAttempted(true)`, `setHasAttemptedSubmit(true)`.
// Such a module calls `focusFirstInvalidField` itself.
//
// A form that marks nothing escapes (a) and (b). So a module that answers the
// server's `invalid_input` with its own sentence (`if (result.error ===
// 'invalid_input') setError('…')`, or the sentence as a conditional's branch)
// must mark fields by (a) or (b) as well: a missing input is named at its
// field, never only in one sentence below the fold. The Arbeitsbericht did
// this until werk-flow/werkflow-planning#67.

/**
 * Error states that hold no field's message: the submit-level failure in
 * `ErrorText`, or the failure of a named request (a read, an upload, a rename,
 * a batch), found by name.
 */
const REQUEST_WORDS =
  'Submit|Server|Action|Save|Upload|Download|Request|Form|Load|Read|Fetch|Options?|Delete|Status|Section|Mutation|Preview|Rename|Details|Batch|Settings|Preference|Dissolve|Dialog|List|Token|Override|Assign\\w*';
const NOT_A_FIELD_ERROR = new RegExp(
  `^(?:error|errors|(?:[a-z]\\w*)?(?:${REQUEST_WORDS})Error|(?:${REQUEST_WORDS.toLowerCase()})Error)$`,
);
const FIELD_ERROR_NAME = /[a-z](?:Error|Errors)$/;
const ATTEMPT_SETTER = /^set(?:Has)?(?:Attempted|AttemptedSubmit|SubmitAttempted)$/;
const FOCUS_OWNER = 'focusFirstInvalidField';

/**
 * Reviewed modules that write a field error without a submit to focus from.
 * Shrink-only: each entry names its reason, and a stale entry fails.
 */
const REVIEWED_EXCEPTIONS: Readonly<Record<string, string>> = {
  'app/(auth)/signup/signup-form.tsx':
    'react-hook-form consumer (canon: not migrated); flagInvalidSignupFields marks the fields and form.setFocus focuses the first',
  'components/password/new-password-fields-form.tsx':
    'react-hook-form consumer: a submit marks the fields and its shouldFocusError focuses the first; the mismatch message sits beside the submit',
  'components/dokumente/attach-document-dialog.tsx':
    'the choice is a checkbox list of documents, not a Field; „Bitte wähle mindestens ein Dokument aus.“ sits beside the submit',
  'components/dokumente/use-document-move-copy.ts':
    'the destination is a folder browser, not a Field; its error renders in the destination dialog beside the submit',
};

function isUseStateCall(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'useState';
  return ts.isPropertyAccessExpression(callee) && callee.name.text === 'useState';
}

/** An argument that clears the error instead of setting one. */
function isEmptyValue(node: ts.Expression | undefined): boolean {
  if (!node) return true;
  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isIdentifier(node)) return node.text === 'undefined';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text === '';
  if (ts.isObjectLiteralExpression(node)) return node.properties.length === 0;
  return false;
}

function fieldErrorSetterName(node: ts.Node): string | null {
  if (!ts.isVariableDeclaration(node) || !ts.isArrayBindingPattern(node.name)) return null;
  if (!isUseStateCall(node.initializer)) return null;
  const [value, setter] = node.name.elements;
  if (!value || !setter || !ts.isBindingElement(value) || !ts.isBindingElement(setter)) return null;
  if (!ts.isIdentifier(value.name) || !ts.isIdentifier(setter.name)) return null;
  const name = value.name.text;
  return FIELD_ERROR_NAME.test(name) && !NOT_A_FIELD_ERROR.test(name) ? setter.name.text : null;
}

const isInvalidInputLiteral = (node: ts.Expression): boolean =>
  ts.isStringLiteralLike(node) && node.text === 'invalid_input';

/** A `=== 'invalid_input'` test whose branch is a literal sentence or sets one. */
function answersInvalidInputWithSentence(node: ts.Node): boolean {
  if (
    !ts.isBinaryExpression(node) ||
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
    !(isInvalidInputLiteral(node.left) || isInvalidInputLiteral(node.right))
  )
    return false;
  const parent = node.parent;
  if (ts.isConditionalExpression(parent) && parent.condition === node)
    return ts.isStringLiteralLike(parent.whenTrue);
  if (!ts.isIfStatement(parent) || parent.expression !== node) return false;
  let setsSentence = false;
  const visit = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      /^set[A-Z]/.test(child.expression.text) &&
      child.arguments[0] !== undefined &&
      ts.isStringLiteralLike(child.arguments[0])
    )
      setsSentence = true;
    ts.forEachChild(child, visit);
  };
  visit(parent.thenStatement);
  return setsSentence;
}

/** The first call that marks fields, or the `invalid_input` sentence of a form that marks none; else null. */
function fieldMarkingWithoutFocus(fileName: string, text?: string): string | null {
  const source = parseProductSource(fileName, text);
  const setters = new Set<string>();
  const calls: ts.CallExpression[] = [];
  let focuses = false;
  let invalidInputSentence = false;
  const visit = (node: ts.Node): void => {
    const setter = fieldErrorSetterName(node);
    if (setter) setters.add(setter);
    if (ts.isIdentifier(node) && node.text === FOCUS_OWNER) focuses = true;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) calls.push(node);
    if (answersInvalidInputWithSentence(node)) invalidInputSentence = true;
    ts.forEachChild(node, visit);
  };
  visit(source);
  let marking: string | null = null;
  for (const call of calls) {
    const name = ts.isIdentifier(call.expression) ? call.expression.text : '';
    const [argument] = call.arguments;
    if (setters.has(name) && !isEmptyValue(argument)) marking ??= `${name}(…)`;
    if (ATTEMPT_SETTER.test(name) && argument?.kind === ts.SyntaxKind.TrueKeyword)
      marking ??= `${name}(true)`;
  }
  if (marking) return focuses ? null : marking;
  return invalidInputSentence ? 'invalid_input answered with a sentence, no field marked' : null;
}

describe('form validation focus', () => {
  const findings = new Map<string, string>();
  for (const file of listProductSources(['app', 'components'])) {
    const marking = fieldMarkingWithoutFocus(file);
    if (marking) findings.set(file, marking);
  }

  test('every form that marks its fields focuses the first through focusFirstInvalidField', () => {
    const unreviewed = [...findings].filter(([file]) => !(file in REVIEWED_EXCEPTIONS));
    expect(unreviewed.map(([file, marking]) => `${file}: ${marking}`)).toEqual([]);
  });

  test('every reviewed exception still marks fields without focusing', () => {
    expect(Object.keys(REVIEWED_EXCEPTIONS).filter((file) => !findings.has(file))).toEqual([]);
  });

  test('probes: a form that marks fields without the owner is reported, the valid shapes are not', () => {
    const component = (body: string) =>
      `export function Probe() { const [reason, setReason] = useState(''); ${body} return null; }`;
    for (const body of [
      "const [reasonError, setReasonError] = useState<string | null>(null); const submit = () => { if (!reason) { setReasonError('Bitte gib einen Grund an.'); return; } };",
      'const [fieldErrors, setFieldErrors] = useState({}); const submit = () => setFieldErrors(check(reason));',
      'const [attempted, setAttempted] = useState(false); const submit = () => { setAttempted(true); };',
      "const [dateErrors, setDateErrors] = React.useState({}); const submit = () => { setDateErrors({ start: 'Bitte wähle ein Datum.' }); document.getElementById('start')?.focus(); };",
      // The Arbeitsbericht before werk-flow/werkflow-planning#67: it focused only its correction reason.
      "const [error, setError] = useState<string | null>(null); const submit = async () => { if (focusFirstInvalidField({ reason: undefined })) return; const result = await save(); if (!result.success) { if (result.error === 'invalid_input') setError('Bitte fülle die Pflichtangaben aus.'); return; } };",
      "const [error, setError] = useState<string | null>(null); const submit = async () => { const result = await save(); if (!result.success) setError(result.error === 'invalid_input' ? 'Bitte gib einen Namen an.' : 'Fehler'); };",
    ]) {
      expect(fieldMarkingWithoutFocus('components/probe.tsx', component(body)), body).not.toBeNull();
    }
    for (const body of [
      "const [reasonError, setReasonError] = useState<string | null>(null); const submit = () => { const next = reason ? undefined : 'Bitte gib einen Grund an.'; setReasonError(next ?? null); if (focusFirstInvalidField({ reason: next })) return; };",
      'const [error, setError] = useState<string | null>(null); const submit = () => setError(describeFailure(code));',
      "const [submitError, setSubmitError] = useState<string | null>(null); const submit = () => setSubmitError('Fehler');",
      "const [loadError, setLoadError] = useState<string | null>(null); const read = () => setLoadError('Fehler');",
      'const [fieldErrors, setFieldErrors] = useState({}); const change = () => setFieldErrors({});',
      'const [reasonError, setReasonError] = useState<string | null>(null); const change = () => setReasonError(null);',
      'const [attempted, setAttempted] = useState(false); const reset = () => setAttempted(false);',
      "const [nameError, setNameError] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const submit = async () => { const next = reason ? undefined : 'Bitte gib einen Namen an.'; setNameError(next ?? null); if (focusFirstInvalidField({ name: next })) return; const result = await save(); if (!result.success) setError(result.error === 'invalid_input' ? 'Bitte prüfe den Namen.' : 'Fehler'); };",
      'const [error, setError] = useState<string | null>(null); const submit = async () => { const result = await save(); if (!result.success) setError(describeFailure(result.error)); };',
    ]) {
      expect(fieldMarkingWithoutFocus('components/probe.tsx', component(body)), body).toBeNull();
    }
  });
});
