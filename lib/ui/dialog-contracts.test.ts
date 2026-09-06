import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import ts from 'typescript';

type Component = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
type FormBoundary = { id: string; conditions: string[] };
type DialogContract = {
  key: string;
  owner: string;
  forms: number;
  bodies: number;
  uncoveredControls: string[];
  contentScrolls: boolean;
  formBoundaries: FormBoundary[];
  associatedSubmits: FormBoundary[];
};

const portalBoundaries = new Set([
  'Dialog', 'DialogContent', 'DialogPortal', 'AlertDialog', 'AlertDialogContent',
  'Portal', 'PopoverContent', 'SelectContent', 'DropdownMenuContent', 'TooltipContent',
]);
const editableControls = new Set([
  'input', 'textarea', 'select', 'Input', 'Textarea', 'Select', 'SearchableSelect',
  'SearchableMultiSelect', 'Checkbox', 'DatePicker', 'DateTimeField', 'TimeInput',
  'QuantityStepper', 'DurationHoursInput', 'SignaturePad',
]);

function isComponent(node: ts.Node): node is Component {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function ownerName(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!isComponent(parent)) continue;
    if ('name' in parent && parent.name) return parent.name.getText();
    if (ts.isVariableDeclaration(parent.parent)) return parent.parent.name.getText();
  }
  return '<anonymous>';
}

function attributeValue(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): string {
  const attribute = opening.attributes.properties.find((part): part is ts.JsxAttribute =>
    ts.isJsxAttribute(part) && part.name.getText() === name);
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  return ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText() ?? '' : '';
}

function renderConditions(node: ts.Node): string[] {
  const conditions: string[] = [];
  function complement(condition: ts.Expression): string {
    if (ts.isBinaryExpression(condition)) {
      if (condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
        return `${condition.left.getText()} !== ${condition.right.getText()}`;
      }
      if (condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        return `${condition.left.getText()} === ${condition.right.getText()}`;
      }
    }
    if (ts.isPrefixUnaryExpression(condition) && condition.operator === ts.SyntaxKind.ExclamationToken) {
      return condition.operand.getText();
    }
    return `!(${condition.getText()})`;
  }
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isConditionalExpression(parent)) {
      if (parent.whenTrue === child) conditions.push(parent.condition.getText());
      if (parent.whenFalse === child) conditions.push(complement(parent.condition));
    }
    if (ts.isBinaryExpression(parent) && parent.right === child && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      conditions.push(parent.left.getText());
    }
    if (isComponent(parent)) break;
  }
  return conditions.map((condition) => condition.replace(/\s/g, ''));
}

function localInitializer(identifier: ts.Identifier): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find((entry) =>
        ts.isIdentifier(entry.name) && entry.name.text === identifier.text);
      if (declaration) return declaration.initializer;
    }
  }
  return undefined;
}

/** Follow rendered component returns, never unrelated functions or nested portals. */
function inspectDialogs(files: ReadonlyMap<string, string>): DialogContract[] {
  const sources = new Map([...files].map(([file, text]) => [file,
    ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]));

  function imported(source: ts.SourceFile, name: string): { file: string; name: string } | undefined {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      let exported: string | undefined;
      if (bindings && ts.isNamedImports(bindings)) {
        const match = bindings.elements.find((element) => element.name.text === name);
        if (match) exported = match.propertyName?.text ?? match.name.text;
      }
      if (bindings && ts.isNamespaceImport(bindings) && name.startsWith(`${bindings.name.text}.`)) {
        exported = name.slice(bindings.name.text.length + 1);
      }
      if (statement.importClause?.name?.text === name) exported = 'default';
      if (!exported) continue;
      const specifier = statement.moduleSpecifier.text;
      const base = specifier.startsWith('@/') ? specifier.slice(2)
        : posix.normalize(posix.join(dirname(source.fileName), specifier));
      const file = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`]
        .find((candidate) => sources.has(candidate));
      return { file: file ?? base, name: exported };
    }
    return undefined;
  }

  function tagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
    const raw = node.tagName.getText();
    return imported(node.getSourceFile(), raw)?.name ?? raw;
  }

  function componentAt(source: ts.SourceFile, name: string): Component | undefined {
    const binding = imported(source, name);
    if (binding) {
      // UI primitives own their implementation; their children retain the caller's form context.
      if (binding.file.startsWith('components/ui/')) return undefined;
      const target = sources.get(binding.file);
      return target ? componentAt(target, binding.name) : undefined;
    }
    let found: Component | undefined;
    function visit(node: ts.Node): void {
      if (ts.isFunctionDeclaration(node) && (node.name?.text === name ||
        (name === 'default' && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)))) {
        found = node;
        return;
      }
      if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer) {
        if (isComponent(node.initializer)) found = node.initializer;
        else if (ts.isCallExpression(node.initializer)) {
          found = node.initializer.arguments.find((argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
            ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
        }
      }
      if (!found) ts.forEachChild(node, visit);
    }
    visit(source);
    return found;
  }

  const contracts: DialogContract[] = [];
  for (const [file, source] of sources) {
    function discover(node: ts.Node): void {
      if (ts.isJsxElement(node) && tagName(node.openingElement) === 'DialogContent') {
        const owner = `${file}#${ownerName(node)}`;
        let title = '';
        function findTitle(child: ts.Node): void {
          if (ts.isJsxElement(child)) {
            const tag = tagName(child.openingElement);
            if (child !== node && portalBoundaries.has(tag)) return;
            if (tag === 'DialogTitle') {
              title = child.children.filter((part) => ts.isJsxText(part) || ts.isJsxExpression(part))
                .map((part) => part.getText()).join(' ').replace(/\s+/g, ' ').trim();
            }
          }
          ts.forEachChild(child, findTitle);
        }
        findTitle(node);
        const contract: DialogContract = {
          key: `${owner}|${title}`, owner, forms: 0, bodies: 0,
          uncoveredControls: [], contentScrolls: false,
          formBoundaries: [], associatedSubmits: [],
        };
        const classAttribute = node.openingElement.attributes.properties.find((attribute) =>
          ts.isJsxAttribute(attribute) && attribute.name.getText() === 'className');
        if (classAttribute) {
          const inspectedClasses = new Set<ts.Node>();
          function inspectClass(part: ts.Node): void {
            if (inspectedClasses.has(part)) return;
            inspectedClasses.add(part);
            if ((ts.isStringLiteralLike(part) || ts.isTemplateHead(part) || ts.isTemplateMiddle(part) || ts.isTemplateTail(part)) &&
              /(?:^|[\s:])!?overflow(?:-[xy])?-(?:auto|scroll)(?:\s|$)/.test(part.text)) {
              contract.contentScrolls = true;
            }
            if (ts.isIdentifier(part)) {
              function findInitializer(candidate: ts.Node): void {
                if (ts.isVariableDeclaration(candidate) && candidate.name.getText() === part.getText() && candidate.initializer) {
                  inspectClass(candidate.initializer);
                }
                ts.forEachChild(candidate, findInitializer);
              }
              findInitializer(source);
            }
            ts.forEachChild(part, inspectClass);
          }
          inspectClass(classAttribute);
        }

        function walk(current: ts.Node, inForm: boolean, active: ReadonlySet<ts.Node>, children: readonly ts.JsxChild[] = []): void {
          if (ts.isJsxExpression(current) && current.expression &&
            ['children', 'props.children'].includes(current.expression.getText())) {
            for (const child of children) walk(child, inForm, active);
            return;
          }
          if (ts.isJsxExpression(current) && current.expression && ts.isIdentifier(current.expression)) {
            const initializer = localInitializer(current.expression);
            if (initializer && !active.has(initializer)) {
              walk(initializer, inForm, new Set([...active, initializer]), children);
              return;
            }
          }
          if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
            const opening = ts.isJsxElement(current) ? current.openingElement : current;
            const tag = tagName(opening);
            if (current !== node && portalBoundaries.has(tag)) return;
            if (tag === 'form') {
              const submits = opening.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) &&
                ['onSubmit', 'action'].includes(attribute.name.getText()));
              if (submits) {
                contract.forms += 1;
                contract.formBoundaries.push({ id: attributeValue(opening, 'id'), conditions: renderConditions(current) });
              }
              inForm = submits;
            }
            if (['Button', 'button', 'input'].includes(tag) && attributeValue(opening, 'type') === 'submit' && attributeValue(opening, 'form')) {
              contract.associatedSubmits.push({ id: attributeValue(opening, 'form'), conditions: renderConditions(current) });
            }
            if (tag === 'DialogBody') contract.bodies += 1;
            if (editableControls.has(tag) && !inForm) contract.uncoveredControls.push(tag);
            const implementation = editableControls.has(tag) ? undefined
              : componentAt(current.getSourceFile(), opening.tagName.getText());
            if (implementation && !active.has(implementation)) {
              const next = new Set([...active, implementation]);
              const passedChildren = ts.isJsxElement(current) ? current.children : [];
              function render(part: ts.Node): void {
                if (part !== implementation && isComponent(part)) return;
                if (ts.isReturnStatement(part) && part.expression) {
                  walk(part.expression, inForm, next, passedChildren);
                  return;
                }
                ts.forEachChild(part, render);
              }
              if (ts.isArrowFunction(implementation) && !ts.isBlock(implementation.body)) {
                walk(implementation.body, inForm, next, passedChildren);
              } else render(implementation);
              return;
            }
            if (ts.isJsxElement(current)) for (const child of current.children) walk(child, inForm, active, children);
            return;
          }
          ts.forEachChild(current, (child) => walk(child, inForm, active, children));
        }
        walk(node, false, new Set());
        contracts.push(contract);
      }
      ts.forEachChild(node, discover);
    }
    discover(source);
  }
  return contracts;
}

type ExceptionKind = 'command' | 'browser' | 'widget' | 'destructive' | 'multiple-actions' | 'inactive';
type DialogException = { kind: ExceptionKind; reason: string };
// Exact owners/titles make additions and changed responsibilities require review.
// Search, upload, override and multi-operation dialogs must not acquire an accidental default action.
const exceptions: Record<string, DialogException> = {
  'components/time-activity-dialog.tsx#TimeActivityDialogForm|{state?.isClockedIn ? \'Aktivität wechseln\' : \'Zeiterfassung starten\'}': { kind: 'multiple-actions', reason: 'Starting, switching and recovering activity have separate explicit commands.' },
  'components/anfragen/convert-request-to-service-dialog.tsx#ConvertRequestToServiceDialog|Anfrage als Servicefall übernehmen?': { kind: 'command', reason: 'Confirms conversion of existing request data; there are no editable fields.' },
  'components/anfragen/request-detail-content.tsx#RequestDetailContent|Kunden zuordnen': { kind: 'command', reason: 'Enter in the staged customer picker selects a result; assignment is explicit.' },
  'components/arbeitsvorlagen/apply-work-template-card.tsx#ApplyWorkTemplateCard|Arbeitsvorlage anwenden': { kind: 'command', reason: 'Version selection, preview and additional-application acknowledgement precede explicit application.' },
  'components/arbeitsvorlagen/work-templates-content.tsx#TemplateEditorDialog|Arbeitsvorlage': { kind: 'inactive', reason: 'Closed placeholder while no draft is available; the real editor owns a form.' },
  'components/auftraege/client-assignment-dialog.tsx#ClientAssignmentDialog|{title}': { kind: 'command', reason: 'Staged customer picker; Enter selects an option instead of confirming assignment.' },
  'components/auftraege/job-detail-content.tsx#JobDetailContent|Mitarbeiter zuweisen': { kind: 'command', reason: 'Multi-selection is followed by an explicit assignment command.' },
  'components/auftraege/project-assignment-dialog.tsx#ProjectAssignmentDialog|{title}': { kind: 'command', reason: 'Staged project picker; Enter selects an option before explicit assignment.' },
  'components/auftraege/project-jobs-assignment-dialog.tsx#ProjectJobsAssignmentDialog|{title}': { kind: 'command', reason: 'Job multi-selection is followed by an explicit assignment command.' },
  'components/auftraege/qualification-warning-dialog.tsx#QualificationWarningDialogContent|Zuweisung prüfen': { kind: 'command', reason: 'Reasoned qualification override requires deliberate acknowledgement.' },
  'components/auftraege/work-artifacts-section.tsx#WorkArtifactDialog|{detail ? currentRevision?.title ?? \'Arbeitsnachweis\' : \'Arbeitsnachweis erstellen\'}': { kind: 'multiple-actions', reason: 'Review, signature and disposition remain explicit commands; editing-mode submission is enforced separately.' },
  'components/dokumente/attach-document-dialog.tsx#AttachDocumentDialog|Vorhandenes Dokument verknüpfen': { kind: 'browser', reason: 'Search and select existing documents before explicit linking.' },
  'components/dokumente/document-library-content.tsx#MoveDestinationDialog|{title}': { kind: 'browser', reason: 'Folder tree navigation precedes an explicit move command.' },
  'components/dokumente/document-library-content.tsx#DocumentLibraryContent|Dateidetails': { kind: 'widget', reason: 'Metadata and version operations commit independently; no dialog-wide submit.' },
  'components/dokumente/document-link-dialog.tsx#DocumentLinkDialog|Verknüpfungen verwalten': { kind: 'browser', reason: 'Search and select targets before explicit linking.' },
  'components/dokumente/document-upload-dialog.tsx#DocumentUploadDialog|{title}': { kind: 'browser', reason: 'Upload queue presents per-file status and explicit upload/retry commands.' },
  'components/dokumente/document-viewer-dialog.tsx#DocumentViewerDialog|{document?.displayName ?? \'Dokument\'}': { kind: 'browser', reason: 'Document viewer owns its media viewport and download controls.' },
  'components/kalender/dispatch-issue-dialog.tsx#DispatchIssueDialog|Einsatz senden': { kind: 'command', reason: 'Dispatch and readiness overrides require explicit confirmation.' },
  'components/kalender/dispatch-panel.tsx#DispatchPanel|Verschiebung prüfen': { kind: 'command', reason: 'Confirms the reviewed batch move rather than editing a record.' },
  'components/kalender/entry-details-dialog.tsx#EntryDetailsDialog|Eintrag Details': { kind: 'multiple-actions', reason: 'Review and delete remain explicit commands; the ordinary editing form is enforced separately.' },
  'components/kalender/planning-warning-dialog.tsx#usePlanningWarningConfirmation|Planungshinweise prüfen': { kind: 'command', reason: 'Readiness warning overrides need deliberate acknowledgement.' },
  'components/kunden/use-communication-contact-guard.tsx#useCommunicationContactGuard|Kontaktvorgabe prüfen': { kind: 'command', reason: 'Contact-policy override requires an explicit reasoned confirmation.' },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Organisationszugang steuern': { kind: 'destructive', reason: 'Access authority transitions include suspension and require explicit action selection.' },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Beschäftigungsübergang erfassen': { kind: 'destructive', reason: 'Employment transitions include ending employment and require explicit confirmation.' },
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection|Geschützte Personalunterlage': { kind: 'command', reason: 'File upload and access-class selection culminate in an explicit upload command.' },
  'components/service/maintenance-coverage-documents-dialog.tsx#MaintenanceCoverageDocumentsDialog|Dokumente zu {coverage.coverageNumber}': { kind: 'browser', reason: 'Embedded document browser owns separate link/upload/rename operations.' },
  'components/service/maintenance-due-action-dialog.tsx#MaintenanceDueActionDialog|Fälligkeit bearbeiten': { kind: 'multiple-actions', reason: 'Schedule/create and skipped/cancelled/superseded transitions have different consequences.' },
  'components/service/maintenance-plan-action-dialog.tsx#MaintenancePlanActionDialog|{title}': { kind: 'destructive', reason: 'Lifecycle commands include termination; require deliberate confirmation.' },
  'components/settings/profile-avatar-section.tsx#ProfileAvatarSection|Profilbild anpassen': { kind: 'widget', reason: 'Interactive crop/zoom editor uses an explicit image-save action.' },
  'components/settings/responsibility-settings.tsx#ConfigurationDialog|{RESPONSIBILITY_LABELS[responsibility]} ändern': { kind: 'command', reason: 'Preview resolved authority holders before explicitly saving responsibility configuration.' },
  'components/zeiterfassung/sickness-section.tsx#SicknessCancelDialog|Krankmeldung stornieren': { kind: 'destructive', reason: 'Cancellation confirmation has no editable data and must remain explicit.' },
  'components/zeiterfassung/time-correction-dialog.tsx#TimeCorrectionDialog|Zeitkorrektur': { kind: 'multiple-actions', reason: 'Deletion remains an explicit command; non-delete correction forms are enforced separately.' },
};

// Pin long forms already repaired. Short forms without a scrollable content shell
// need no separate body: there is no scrolling region to separate from the footer.
const longDialogOwners = new Set([
  'components/service/equipment-form-dialog.tsx#EquipmentFormDialog',
  'components/service/service-case-form-dialog.tsx#ServiceCaseFormDialog',
  'components/service/maintenance-plan-dialog.tsx#MaintenancePlanDialog',
  'components/service/maintenance-coverage-dialog.tsx#MaintenanceCoverageDialog',
  'components/service/maintenance-coverage-documents-dialog.tsx#MaintenanceCoverageDocumentsDialog',
  'components/service/equipment-detail-content.tsx#EquipmentDetailContent',
  'components/service/service-case-detail-content.tsx#RelationDialog',
  'components/service/service-case-detail-content.tsx#EvidenceDialog',
  'components/mitarbeiter/personnel-lifecycle-section.tsx#PersonnelLifecycleSection',
  'components/settings/personnel-onboarding-template-settings.tsx#PersonnelOnboardingTemplateSettings',
  'components/inventar/location-select-with-create.tsx#CreateLocationDialog',
  'components/dokumente/contextual-documents-section.tsx#ContextualDocumentsSection',
]);

type EditingMode = { formId: string; condition: string };
// These dialogs have command-only modes, but their ordinary editing branches
// still require native submission. An exception cannot erase that branch.
const editingModes: Record<string, EditingMode> = {
  'components/kalender/entry-details-dialog.tsx#EntryDetailsDialog': { formId: 'editFormId', condition: 'isEditing' },
  'components/zeiterfassung/time-correction-dialog.tsx#TimeCorrectionDialog': { formId: 'correctionFormId', condition: "kind !== 'delete'" },
  'components/auftraege/work-artifacts-section.tsx#WorkArtifactDialog': { formId: 'artifactFormId', condition: '!readOnly && editing' },
};

function editingViolations(contract: DialogContract, mode: EditingMode): string[] {
  const condition = mode.condition.replace(/\s/g, '');
  const forms = contract.formBoundaries.filter((form) => form.id === mode.formId);
  const submits = contract.associatedSubmits.filter((submit) => submit.id === mode.formId);
  const failures: string[] = [];
  if (forms.length === 0) failures.push('editable mode lost its owned submitting form');
  if (submits.length === 0) failures.push('editable mode lost its associated footer submit');
  if ([...forms, ...submits].some((boundary) => !boundary.conditions.includes(condition))) {
    failures.push('editing form or associated submit escapes its non-destructive mode');
  }
  return failures;
}

function violations(contract: DialogContract, exception?: DialogException, requiresBody = false): string[] {
  const failures: string[] = [];
  if (!exception && contract.forms === 0) failures.push('missing owned native submitting form or reviewed exception');
  if (!exception && contract.uncoveredControls.length) failures.push(`editable controls outside owned form: ${[...new Set(contract.uncoveredControls)].join(', ')}`);
  if (contract.contentScrolls) failures.push('DialogContent scrolls; move the scroll region into DialogBody');
  if (requiresBody && contract.bodies === 0) failures.push('long dialog lost its owned DialogBody');
  if (contract.associatedSubmits.some((submit) => !contract.formBoundaries.some((form) => form.id === submit.id))) {
    failures.push('footer submit does not reference an owned submitting form');
  }
  return failures;
}

// This whole-repository AST census measured 5.3 s on Windows; it is not a latency contract.
test('every application dialog has an owned form or a reasoned interaction exception', () => {
  const root = resolve(import.meta.dir, '../..');
  const files = new Map<string, string>();
  for (const directory of ['app', 'components']) {
    for (const entry of readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })) {
      const file = `${directory}/${entry.replaceAll('\\', '/')}`;
      if (file.endsWith('.tsx') || file.endsWith('.ts')) files.set(file, readFileSync(resolve(root, file), 'utf8'));
    }
  }
  const dialogs = inspectDialogs(files);
  const failures = dialogs.flatMap((dialog) => [
    ...violations(dialog, exceptions[dialog.key], longDialogOwners.has(dialog.owner)),
    ...(editingModes[dialog.owner] ? editingViolations(dialog, editingModes[dialog.owner]) : []),
  ].map((message) => `${dialog.key}: ${message}`));
  for (const [key, exception] of Object.entries(exceptions)) {
    if (!dialogs.some((dialog) => dialog.key === key)) failures.push(`stale dialog exception: ${key}`);
    expect(exception.reason.length).toBeGreaterThan(30);
  }
  for (const owner of longDialogOwners) {
    if (!dialogs.some((dialog) => dialog.owner === owner)) failures.push(`stale long-dialog owner: ${owner}`);
  }
  for (const owner of Object.keys(editingModes)) {
    if (!dialogs.some((dialog) => dialog.owner === owner)) failures.push(`stale editable-mode owner: ${owner}`);
  }
  expect(dialogs.length).toBeGreaterThan(0);
  expect(failures).toEqual([]);
}, 15_000);

function fixture(source: string, additional: Record<string, string> = {}): DialogContract {
  const dialog = inspectDialogs(new Map([['components/example.tsx', source], ...Object.entries(additional)]))[0];
  if (!dialog) throw new Error('Fixture must declare a dialog');
  return dialog;
}

test('a short owned form does not need a separate scrolling body', () => {
  const dialog = fixture('function Edit(){ return <DialogContent><form onSubmit={save}><Input/><button type="submit">Save</button></form></DialogContent> }');
  expect(violations(dialog)).toEqual([]);
});

test('a form outside the portal and a nested dialog form cannot claim outer inputs', () => {
  const dialog = fixture('function Edit(){ return <form onSubmit={save}><DialogContent><Input/><Dialog><DialogContent><form onSubmit={save}><DialogBody><Input/></DialogBody></form></DialogContent></Dialog></DialogContent></form> }');
  expect(dialog.forms).toBe(0);
  expect(dialog.bodies).toBe(0);
  expect(violations(dialog)).toHaveLength(2);
});

test('a sibling form does not cover another editable field', () => {
  const dialog = fixture('function Edit(){ return <DialogContent><form onSubmit={save}><Input/></form><Textarea/></DialogContent> }');
  expect(dialog.forms).toBe(1);
  expect(dialog.uncoveredControls).toEqual(['Textarea']);
});

test('FormDisclosure and a non-submitting native form are not submission boundaries', () => {
  const dialog = fixture('function Edit(){ return <DialogContent><FormDisclosure><Input/></FormDisclosure><form><Textarea/></form></DialogContent> }');
  expect(dialog.forms).toBe(0);
  expect(dialog.uncoveredControls).toEqual(['Input', 'Textarea']);
});

test('imported delegated forms are verified from their rendered implementation', () => {
  const dialog = fixture('import { Editor as Fields } from "./fields"; function Edit(){ return <DialogContent><Fields/></DialogContent> }', {
    'components/fields.tsx': 'export function Editor(){ const unrelated = () => <Input/>; return <form action={save}><DialogBody><Input/></DialogBody></form> }',
  });
  expect(dialog.forms).toBe(1);
  expect(dialog.bodies).toBe(1);
  expect(violations(dialog, undefined, true)).toEqual([]);
});

test('component names containing Form do not count as delegated forms', () => {
  const dialog = fixture('function FakeForm(){ return <Input/> } function Edit(){ return <DialogContent><FakeForm/></DialogContent> }');
  expect(dialog.forms).toBe(0);
  expect(dialog.uncoveredControls).toEqual(['Input']);
});

test('a delegated component nested portal cannot satisfy the outer form or body', () => {
  const dialog = fixture('function Fields(){ return <DialogPortal><form onSubmit={save}><DialogBody><Input/></DialogBody></form></DialogPortal> } function Edit(){ return <DialogContent><Fields/><Input/></DialogContent> }');
  expect(dialog.forms).toBe(0);
  expect(dialog.bodies).toBe(0);
});

test('an owned wrapper form covers its rendered children', () => {
  const dialog = fixture('const Shell = ({children}) => <form onSubmit={save}><DialogBody>{children}</DialogBody></form>; function Edit(){ return <DialogContent><Shell><Input/></Shell></DialogContent> }');
  expect(dialog.forms).toBe(1);
  expect(dialog.uncoveredControls).toEqual([]);
});

test('aliased dialog imports remain discoverable', () => {
  const dialog = fixture('import { DialogContent as Modal } from "@/components/ui/dialog"; function Edit(){ return <Modal><Input/></Modal> }');
  expect(dialog.uncoveredControls).toEqual(['Input']);
});

test('whole-content responsive and conditional scrolling fails even with an owned body', () => {
  const dialog = fixture('function Edit(){ return <DialogContent className={cn("overflow-hidden", long && "md:overflow-y-auto")}><form onSubmit={save}><DialogBody><Input/></DialogBody></form></DialogContent> }');
  expect(violations(dialog)).toEqual(['DialogContent scrolls; move the scroll region into DialogBody']);
});

test('local class constants cannot hide a whole-content scroller', () => {
  const dialog = fixture('const shell = "overflow-y-scroll"; function Edit(){ return <DialogContent className={shell}><form onSubmit={save}><Input/></form></DialogContent> }');
  expect(dialog.contentScrolls).toBe(true);
});

test('exceptions classify interaction semantics without exempting whole-content scroll', () => {
  const dialog = fixture('function Browser(){ return <DialogContent className="overflow-auto"><Input/></DialogContent> }');
  expect(violations(dialog, { kind: 'browser', reason: 'Search picks a document before an explicit linking command.' })).toEqual([
    'DialogContent scrolls; move the scroll region into DialogBody',
  ]);
});

test('conditional editing resolves composed fields and external footer form ownership', () => {
  const dialog = fixture('function Edit(){ const content = <Input/>; return <DialogContent>{editing ? <form id="edit" onSubmit={save}>{content}</form> : <p>Read only</p>}<DialogFooter>{editing && <Button type="submit" form="edit">Save</Button>}</DialogFooter></DialogContent> }');
  expect(dialog.uncoveredControls).toEqual([]);
  expect(violations(dialog)).toEqual([]);
  expect(editingViolations(dialog, { formId: 'edit', condition: 'editing' })).toEqual([]);
});

test('a command exception cannot hide removal of its editing form', () => {
  const dialog = fixture('function Edit(){ return <DialogContent><Input/></DialogContent> }');
  expect(editingViolations(dialog, { formId: 'edit', condition: 'editing' })).toEqual([
    'editable mode lost its owned submitting form', 'editable mode lost its associated footer submit',
  ]);
});

test('a footer submit cannot target a sibling or nested-portal form', () => {
  const dialog = fixture('function Edit(){ return <DialogContent><form id="edit" onSubmit={save}><Input/></form><Dialog><DialogContent><form id="other" onSubmit={save}/></DialogContent></Dialog><DialogFooter><Button type="submit" form="other">Save</Button></DialogFooter></DialogContent> }');
  expect(violations(dialog)).toEqual(['footer submit does not reference an owned submitting form']);
});

test('delete-mode confirmation must not become an implicit editing submit', () => {
  const dialog = fixture('function Edit(){ return <DialogContent>{kind !== "delete" ? <form id="edit" onSubmit={save}><Input/></form> : <Button type="button" onClick={remove}>Delete</Button>}<DialogFooter>{kind !== "delete" ? <Button type="submit" form="edit">Save</Button> : <Button type="submit" form="edit">Delete</Button>}</DialogFooter></DialogContent> }');
  expect(editingViolations(dialog, { formId: 'edit', condition: 'kind !== "delete"' })).toEqual([
    'editing form or associated submit escapes its non-destructive mode',
  ]);
});

test('the alternate branch of an explicit delete command is the non-delete submit mode', () => {
  const dialog = fixture('function Edit(){ return <DialogContent>{kind !== "delete" ? <form id="edit" onSubmit={save}><Input/></form> : null}<DialogFooter>{kind === "delete" ? <Button type="button" onClick={remove}>Delete</Button> : <Button type="submit" form="edit">Save</Button>}</DialogFooter></DialogContent> }');
  expect(editingViolations(dialog, { formId: 'edit', condition: 'kind !== "delete"' })).toEqual([]);
});
