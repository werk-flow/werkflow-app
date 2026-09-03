'use client'

import { useMemo, useState, type ReactElement } from 'react'
import { usePendingTask } from '@/hooks/use-server-action';
import { Archive, ArrowDown, ArrowUp, History, Loader2, Plus, RotateCcw, Save, Send, Trash2 } from 'lucide-react'

import { LocationSelectWithCreate } from '@/components/inventar/location-select-with-create'
import { usePageAction } from '@/components/shared/page-action'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ErrorText } from '@/components/ui/error-text'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QuantityStepper } from '@/components/ui/quantity-stepper'
import { SearchableMultiSelect } from '@/components/ui/searchable-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SelectWithCreate } from '@/components/ui/select-with-create'
import { Textarea } from '@/components/ui/textarea'
import { useBanner } from '@/components/ui/banner'
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view'
import { upsertInventoryItem } from '@/lib/inventory/actions'
import type { InventoryLocation, InventoryPickerOption } from '@/lib/inventory/types'
import { createCapability } from '@/lib/qualifications/actions'
import type { CapabilityDefinition, CapabilityKind } from '@/lib/qualifications/types'
import { parseDecimalInput } from '@/lib/ui/decimal'
import {
  createNextWorkTemplateDraft,
  createWorkTemplate,
  getWorkTemplate,
  getWorkTemplates,
  publishWorkTemplate,
  saveWorkTemplateDraft,
  setWorkTemplateArchived,
} from '@/lib/work-templates/actions'
import type { WorkTemplateDetail, WorkTemplateDraft, WorkTemplateSummary, WorkTemplateTargetType } from '@/lib/work-templates/types'

type Props = {
  initialTemplates: WorkTemplateSummary[]
  inventoryItems: InventoryPickerOption[]
  inventoryLocations: InventoryLocation[]
  capabilities: CapabilityDefinition[]
}

const ERROR_MESSAGES: Record<string, string> = {
  validation_failed: 'Bitte prüfe die markierten Angaben.',
  work_template_item_required: 'Füge mindestens eine Aufgabe oder einen Checklistenpunkt hinzu.',
  work_template_dependency_cycle: 'Abhängigkeiten dürfen keinen Kreis bilden.',
  work_template_reference_unavailable: 'Mindestens ein Material, Lager oder eine Qualifikation ist nicht mehr aktiv.',
  not_authorized: 'Du darfst Arbeitsvorlagen nicht verwalten.',
  operation_failed: 'Die Änderung konnte nicht gespeichert werden.',
}

function newId(): string {
  return crypto.randomUUID()
}

function move<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function WorkTemplatesContent({ initialTemplates, inventoryItems, inventoryLocations, capabilities }: Props): ReactElement {
  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState<'all' | WorkTemplateTargetType>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'draft' | 'published' | 'archived'>('active')
  // The create button lives in the page header outside the data boundary.
  const { open: createOpen, setOpen: setCreateOpen } = usePageAction()
  const [editing, setEditing] = useState<WorkTemplateDetail | null>(null)
  const { run: runPendingTask, isPending } = usePendingTask();
  const { showBanner } = useBanner()

  const view = useLiveView<WorkTemplateSummary[]>({
    tables: ['work_templates', 'work_template_versions', 'work_template_applications'],
    read: async (): Promise<LiveViewResult<WorkTemplateSummary[]>> => {
      const result = await getWorkTemplates()
      return result.success ? { ok: true, data: result.data } : { ok: false }
    },
    initialData: initialTemplates,
  })
  const templates = view.data ?? initialTemplates
  const reload = view.refresh

  const filtered = useMemo(() => templates.filter((template) => {
    const query = search.trim().toLocaleLowerCase('de')
    if (query && !`${template.name} ${template.description ?? ''}`.toLocaleLowerCase('de').includes(query)) return false
    if (targetFilter !== 'all' && template.targetType !== targetFilter) return false
    if (statusFilter === 'active' && template.archivedAt) return false
    if (statusFilter === 'archived' && !template.archivedAt) return false
    if (statusFilter === 'draft' && (template.status !== 'draft' || template.archivedAt)) return false
    if (statusFilter === 'published' && (!template.currentPublishedVersionId || template.archivedAt)) return false
    return true
  }), [search, statusFilter, targetFilter, templates])

  function openEditor(templateId: string) {
    void runPendingTask(async () => {
      const result = await getWorkTemplate(templateId)
      if (!result.success) {
        showBanner({ variant: 'error', message: 'Die Arbeitsvorlage konnte nicht geladen werden.' })
        return
      }
      setEditing(result.data)
    })
  }

  function changeArchive(template: WorkTemplateSummary) {
    void runPendingTask(async () => {
      const archived = !template.archivedAt
      const result = await setWorkTemplateArchived(template.id, archived)
      if (!result.success) {
        showBanner({ variant: 'error', message: 'Der Archivstatus konnte nicht geändert werden.' })
        return
      }
      await reload()
      showBanner({ variant: 'success', message: archived ? 'Arbeitsvorlage archiviert.' : 'Arbeitsvorlage reaktiviert.' })
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Arbeitsvorlagen suchen" htmlFor="template-search" hideLabel><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Arbeitsvorlagen suchen…" /></Field>
        <Select value={targetFilter} onValueChange={(value) => setTargetFilter(value as typeof targetFilter)}><SelectTrigger aria-label="Ziel filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Aufträge und Projekte</SelectItem><SelectItem value="job">Nur Aufträge</SelectItem><SelectItem value="project">Nur Projekte</SelectItem></SelectContent></Select>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}><SelectTrigger aria-label="Status filtern"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Aktive Vorlagen</SelectItem><SelectItem value="draft">Entwürfe</SelectItem><SelectItem value="published">Veröffentlicht</SelectItem><SelectItem value="archived">Archiv</SelectItem></SelectContent></Select>
      </div>

      {templates.length === 0 ? (
        <Card><CardHeader><CardTitle>Erste Arbeitsvorlage anlegen</CardTitle><CardDescription>Erstelle die erste Vorlage für einen wiederkehrenden Auftrag oder ein Projekt. WerkFlow liefert keine fremden Standardvorlagen aus.</CardDescription></CardHeader><CardContent><Button onClick={() => setCreateOpen(true)}><Plus className="size-4" />Erste Vorlage erstellen</Button></CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Keine Arbeitsvorlage passt zu Suche und Filtern.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((template) => (
            <Card key={template.id} className="gap-3 py-4"><CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" className="min-w-0 text-left" onClick={() => openEditor(template.id)} disabled={isPending}>
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{template.name}</span><Badge variant="outline">{template.targetType === 'job' ? 'Auftrag' : 'Projekt'}</Badge><Badge variant={template.archivedAt ? 'secondary' : template.status === 'draft' ? 'outline' : 'default'}>{template.archivedAt ? 'Archiviert' : template.status === 'draft' ? 'Entwurf' : `Version ${template.versionNumber}`}</Badge></div>
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{template.description || 'Keine Beschreibung'}</p>
              </button>
              <div className="flex shrink-0 gap-2"><Button variant="outline" onClick={() => openEditor(template.id)}>Öffnen</Button><Button variant="ghost" size="icon" onClick={() => changeArchive(template)} aria-label={template.archivedAt ? 'Arbeitsvorlage reaktivieren' : 'Arbeitsvorlage archivieren'}>{template.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}</Button></div>
            </CardContent></Card>
          ))}
        </div>
      )}

      <CreateTemplateDialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) void reload() }} onCreated={async (templateId) => { setCreateOpen(false); await reload(); showBanner({ variant: 'success', message: 'Arbeitsvorlage wurde erstellt.' }); openEditor(templateId) }} />
      <TemplateEditorDialog detail={editing} onOpenChange={(open) => { if (!open) setEditing(null) }} inventoryItems={inventoryItems} inventoryLocations={inventoryLocations} capabilities={capabilities} onChanged={async (message) => { await reload(); showBanner({ variant: 'success', message }) }} />
    </div>
  )
}

function CreateTemplateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [targetType, setTargetType] = useState<WorkTemplateTargetType>('job')
  const [error, setError] = useState<string | null>(null)
  const { run: runPendingTask, isPending } = usePendingTask();
  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    void runPendingTask(async () => {
      const result = await createWorkTemplate({ name, description, targetType })
      if (!result.success) { setError(ERROR_MESSAGES[result.error] ?? 'Die Arbeitsvorlage konnte nicht erstellt werden.'); return }
      setName(''); setDescription(''); setTargetType('job'); onCreated(result.data.templateId)
    })
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="contents"><DialogHeader><DialogTitle>Arbeitsvorlage erstellen</DialogTitle><DialogDescription>Lege zuerst Ziel und Namen fest. Inhalte ergänzt du im nächsten Schritt.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="new-template-name">Name</Label><Input id="new-template-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="new-template-target">Gilt für</Label><Select value={targetType} onValueChange={(value) => setTargetType(value as WorkTemplateTargetType)}><SelectTrigger id="new-template-target"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="job">Aufträge</SelectItem><SelectItem value="project">Projekte</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="new-template-description">Beschreibung</Label><Textarea id="new-template-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div><ErrorText>{error}</ErrorText></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button><Button type="submit" disabled={isPending}>{isPending && <Loader2 className="size-4 animate-spin" />}Erstellen</Button></DialogFooter></form></DialogContent></Dialog>
}

function TemplateEditorDialog({ detail, onOpenChange, inventoryItems, inventoryLocations, capabilities, onChanged }: { detail: WorkTemplateDetail | null; onOpenChange: (open: boolean) => void; inventoryItems: InventoryPickerOption[]; inventoryLocations: InventoryLocation[]; capabilities: CapabilityDefinition[]; onChanged: (message: string) => Promise<void> }) {
  const [draft, setDraft] = useState<WorkTemplateDraft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { run: runPendingTask, isPending } = usePendingTask();
  const [localInventoryItems, setLocalInventoryItems] = useState(inventoryItems)
  const [localCapabilities, setLocalCapabilities] = useState(capabilities)
  const activeDraft = draft ?? detail?.draft ?? null
  const editable = Boolean(detail?.draftVersionId)

  function update(next: WorkTemplateDraft) { setDraft(next); setError(null) }
  function close(open: boolean) { if (!open) { setDraft(null); setError(null) }; onOpenChange(open) }
  function save() {
    if (!detail || !activeDraft) return
    void runPendingTask(async () => {
      const result = await saveWorkTemplateDraft({ templateId: detail.id, draft: { ...activeDraft, items: activeDraft.items.map((item, index) => ({ ...item, sortOrder: index })), materials: activeDraft.materials.map((item, index) => ({ ...item, sortOrder: index })), capabilities: activeDraft.capabilities.map((item, index) => ({ ...item, sortOrder: index })) } })
      if (!result.success) { setError(ERROR_MESSAGES[result.error] ?? 'Der Entwurf konnte nicht gespeichert werden.'); return }
      await onChanged('Entwurf gespeichert.')
    })
  }
  function publish() {
    if (!detail) return
    void runPendingTask(async () => {
      if (draft) {
        const saveResult = await saveWorkTemplateDraft({ templateId: detail.id, draft: { ...draft, items: draft.items.map((item, index) => ({ ...item, sortOrder: index })), materials: draft.materials.map((item, index) => ({ ...item, sortOrder: index })), capabilities: draft.capabilities.map((item, index) => ({ ...item, sortOrder: index })) } })
        if (!saveResult.success) { setError(ERROR_MESSAGES[saveResult.error] ?? 'Der Entwurf konnte nicht gespeichert werden.'); return }
      }
      const result = await publishWorkTemplate(detail.id)
      if (!result.success) { setError(ERROR_MESSAGES[result.error] ?? 'Die Version konnte nicht veröffentlicht werden.'); return }
      close(false); await onChanged(`Version ${detail.versionNumber} wurde veröffentlicht.`)
    })
  }
  function createNextDraft() {
    if (!detail) return
    void runPendingTask(async () => {
      const result = await createNextWorkTemplateDraft(detail.id)
      if (!result.success) { setError('Die nächste Version konnte nicht angelegt werden.'); return }
      close(false); await onChanged('Ein neuer Entwurf wurde angelegt.')
    })
  }
  if (!detail || !activeDraft) return <Dialog open={false}><DialogContent><DialogTitle>Arbeitsvorlage</DialogTitle></DialogContent></Dialog>

  return <Dialog open onOpenChange={close}><DialogContent className="sm:max-w-4xl"><form onSubmit={(event) => { event.preventDefault(); save() }} className="contents"><DialogHeader><DialogTitle>{editable ? `Entwurf · Version ${detail.versionNumber}` : `${detail.name} · Version ${detail.versionNumber}`}</DialogTitle><DialogDescription>{editable ? 'Nach dem Veröffentlichen bleibt diese Version unveränderlich.' : 'Diese veröffentlichte Version ist unveränderlich. Für Änderungen legst du eine neue Version an.'}</DialogDescription></DialogHeader><DialogBody className="space-y-6 py-1">
    <section className="space-y-4"><h3 className="font-semibold">Grunddaten</h3><div className="space-y-2"><Label htmlFor="template-name">Name</Label><Input id="template-name" value={activeDraft.name} disabled={!editable} onChange={(event) => update({ ...activeDraft, name: event.target.value })} /></div><div className="space-y-2"><Label htmlFor="template-description">Beschreibung</Label><Textarea id="template-description" value={activeDraft.description ?? ''} disabled={!editable} onChange={(event) => update({ ...activeDraft, description: event.target.value || null })} /></div></section>
    <ItemsEditor draft={activeDraft} editable={editable} onChange={update} />
    <MaterialsEditor draft={activeDraft} editable={editable} onChange={update} inventoryItems={localInventoryItems} inventoryLocations={inventoryLocations} onInventoryCreated={(item) => setLocalInventoryItems((current) => [...current, item])} />
    <CapabilitiesEditor draft={activeDraft} editable={editable} onChange={update} capabilities={localCapabilities} onCapabilityCreated={(capability) => setLocalCapabilities((current) => [...current, capability])} />
    <section className="space-y-3"><div className="flex items-center gap-2"><History className="size-4" /><h3 className="font-semibold">Verlauf</h3></div>{detail.history.map((event) => <div key={event.id} className="flex justify-between gap-3 border-b pb-2 text-sm"><span>{event.eventType} {event.versionNumber ? `· Version ${event.versionNumber}` : ''}{event.targetLabel && <span className="block">{event.targetLabel}</span>}<span className="block text-muted-foreground">{event.actorName}</span></span><time className="text-muted-foreground">{new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</time></div>)}</section>
    <ErrorText>{error}</ErrorText>
  </DialogBody><DialogFooter><Button type="button" variant="outline" onClick={() => close(false)}>Schließen</Button>{editable ? <><Button type="submit" variant="outline" disabled={isPending}><Save className="size-4" />Speichern</Button><Button type="button" onClick={publish} disabled={isPending}><Send className="size-4" />Veröffentlichen</Button></> : <Button type="button" onClick={createNextDraft} disabled={isPending}><Plus className="size-4" />Neue Version</Button>}</DialogFooter></form></DialogContent></Dialog>
}

function ItemsEditor({ draft, editable, onChange }: { draft: WorkTemplateDraft; editable: boolean; onChange: (draft: WorkTemplateDraft) => void }) {
  function addItem() { const id = newId(); onChange({ ...draft, items: [...draft.items, { id, itemKind: 'task', content: '', requirementState: 'required', groupLabel: null, notes: null, sortOrder: draft.items.length }] }) }
  function patchItem(index: number, patch: Partial<WorkTemplateDraft['items'][number]>) { onChange({ ...draft, items: draft.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }) }
  function removeItem(id: string) { onChange({ ...draft, items: draft.items.filter((item) => item.id !== id), evidence: draft.evidence.filter((item) => item.templateItemId !== id), dependencies: draft.dependencies.filter((item) => item.predecessorItemId !== id && item.dependentItemId !== id) }) }
  function replacePredecessors(dependentItemId: string, predecessorItemIds: string[]): void {
    const existing = new Map(draft.dependencies.filter((entry) => entry.dependentItemId === dependentItemId).map((entry) => [entry.predecessorItemId, entry]))
    onChange({
      ...draft,
      dependencies: [
        ...draft.dependencies.filter((entry) => entry.dependentItemId !== dependentItemId),
        ...predecessorItemIds.map((predecessorItemId) => existing.get(predecessorItemId) ?? { id: newId(), predecessorItemId, dependentItemId }),
      ],
    })
  }
  return <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Aufgaben und Checkliste</h3><p className="text-sm text-muted-foreground">Dieselben Einträge erscheinen später in der bestehenden Checkliste.</p></div>{editable && <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="size-4" />Eintrag</Button>}</div>
    {draft.items.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Noch keine Aufgaben oder Checklistenpunkte.</p>}
    {draft.items.map((item, index) => { const evidence = draft.evidence.filter((entry) => entry.templateItemId === item.id); const predecessorIds = draft.dependencies.filter((entry) => entry.dependentItemId === item.id).map((entry) => entry.predecessorItemId); return <Card key={item.id} className="gap-3 py-4"><CardContent className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_150px_150px_auto]"><Field label="Bezeichnung" htmlFor={`item-${item.id}`}><Input value={item.content} disabled={!editable} onChange={(event) => patchItem(index, { content: event.target.value })} /></Field><Field label="Art" htmlFor={`kind-${item.id}`}><Select value={item.itemKind} disabled={!editable} onValueChange={(value) => patchItem(index, { itemKind: value as 'task' | 'checklist' })}><SelectTrigger id={`kind-${item.id}`} aria-label={`Art für ${item.content || 'Eintrag'}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="task">Aufgabe</SelectItem><SelectItem value="checklist">Checkliste</SelectItem></SelectContent></Select></Field><Field label="Verbindlichkeit" htmlFor={`requirement-${item.id}`}><Select value={item.requirementState} disabled={!editable} onValueChange={(value) => patchItem(index, { requirementState: value as 'required' | 'optional' })}><SelectTrigger id={`requirement-${item.id}`} aria-label={`Verbindlichkeit für ${item.content || 'Eintrag'}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="required">Erforderlich</SelectItem><SelectItem value="optional">Optional</SelectItem></SelectContent></Select></Field>{editable && <div className="flex items-end gap-1"><Button type="button" size="icon" variant="ghost" disabled={index === 0} onClick={() => onChange({ ...draft, items: move(draft.items, index, -1) })} aria-label="Eintrag nach oben"><ArrowUp className="size-4" /></Button><Button type="button" size="icon" variant="ghost" disabled={index === draft.items.length - 1} onClick={() => onChange({ ...draft, items: move(draft.items, index, 1) })} aria-label="Eintrag nach unten"><ArrowDown className="size-4" /></Button><Button type="button" size="icon" variant="ghost" onClick={() => removeItem(item.id)} aria-label="Eintrag löschen"><Trash2 className="size-4" /></Button></div>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Gruppe" htmlFor={`group-${item.id}`}><Input value={item.groupLabel ?? ''} disabled={!editable} onChange={(event) => patchItem(index, { groupLabel: event.target.value || null })} placeholder="z. B. Inbetriebnahme" /></Field><Field label="Voraussetzungen"><SearchableMultiSelect ariaLabel={`Voraussetzungen für ${item.content || 'Eintrag'}`} options={draft.items.filter((other) => other.id !== item.id).map((other) => ({ value: other.id, label: other.content || 'Unbenannter Eintrag' }))} selectedIds={predecessorIds} onSelectionChange={(ids) => replacePredecessors(item.id, ids)} placeholder="Keine Voraussetzungen" searchPlaceholder="Eintrag suchen…" emptyMessage="Kein anderer Eintrag" disabled={!editable} /></Field></div>
      <Field label="Hinweise" htmlFor={`notes-${item.id}`}><Textarea value={item.notes ?? ''} disabled={!editable} onChange={(event) => patchItem(index, { notes: event.target.value || null })} /></Field>
      <div className="space-y-2"><div className="flex items-center justify-between"><Label>Erwartete Nachweise</Label>{editable && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...draft, evidence: [...draft.evidence, { id: newId(), templateItemId: item.id, description: '', documentCategory: 'photo', sortOrder: evidence.length }] })}><Plus className="size-4" />Nachweis</Button>}</div>{evidence.map((entry) => <div key={entry.id} className="grid gap-2 sm:grid-cols-[1fr_160px_auto]"><Input aria-label="Nachweisbeschreibung" value={entry.description} disabled={!editable} onChange={(event) => onChange({ ...draft, evidence: draft.evidence.map((current) => current.id === entry.id ? { ...current, description: event.target.value } : current) })} placeholder="z. B. Foto der Dichtheitsprüfung" /><Select value={entry.documentCategory} disabled={!editable} onValueChange={(value) => onChange({ ...draft, evidence: draft.evidence.map((current) => current.id === entry.id ? { ...current, documentCategory: value as typeof entry.documentCategory } : current) })}><SelectTrigger aria-label="Dokumentkategorie"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="photo">Foto</SelectItem><SelectItem value="report">Bericht</SelectItem><SelectItem value="contract">Vertrag</SelectItem><SelectItem value="offer">Angebot</SelectItem><SelectItem value="invoice">Rechnung</SelectItem><SelectItem value="other">Sonstiges</SelectItem></SelectContent></Select>{editable && <Button type="button" size="icon" variant="ghost" onClick={() => onChange({ ...draft, evidence: draft.evidence.filter((current) => current.id !== entry.id) })} aria-label="Nachweiserwartung löschen"><Trash2 className="size-4" /></Button>}</div>)}</div>
    </CardContent></Card> })}
  </section>
}

function MaterialsEditor({ draft, editable, onChange, inventoryItems, inventoryLocations, onInventoryCreated }: { draft: WorkTemplateDraft; editable: boolean; onChange: (draft: WorkTemplateDraft) => void; inventoryItems: InventoryPickerOption[]; inventoryLocations: InventoryLocation[]; onInventoryCreated: (item: InventoryPickerOption) => void }) {
  function add() { onChange({ ...draft, materials: [...draft.materials, { id: newId(), itemId: '', preferredLocationId: null, plannedQuantity: 1, isBillable: true, notes: null, sortOrder: draft.materials.length }] }) }
  return <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Geplantes Material</h3><p className="text-sm text-muted-foreground">Mengen werden geplant, nicht reserviert oder ausgebucht.</p></div>{editable && <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="size-4" />Material</Button>}</div>{draft.materials.map((line) => <Card key={line.id} className="gap-3 py-4"><CardContent className="grid gap-3 sm:grid-cols-2"><Field label="Artikel" htmlFor={`material-item-${line.id}`}><SelectWithCreate id={`material-item-${line.id}`} items={inventoryItems} getOption={(item) => ({ value: item.id, label: item.name, description: item.internalSku ?? undefined })} value={line.itemId} onValueChange={(value) => onChange({ ...draft, materials: draft.materials.map((item) => item.id === line.id ? { ...item, itemId: value, isBillable: inventoryItems.find((option) => option.id === value)?.isBillable ?? item.isBillable } : item) })} createLabel="Neuen Artikel erstellen" disabled={!editable} renderCreateDialog={(props) => <CreateMaterialDialog {...props} />} onCreated={onInventoryCreated} /></Field><Field label="Bevorzugtes Lager" htmlFor={`material-location-${line.id}`}><LocationSelectWithCreate id={`material-location-${line.id}`} locations={inventoryLocations} value={line.preferredLocationId ?? ''} onValueChange={(value) => onChange({ ...draft, materials: draft.materials.map((item) => item.id === line.id ? { ...item, preferredLocationId: value || null } : item) })} allowNone disabled={!editable} /></Field><Field label="Geplante Menge" htmlFor={`quantity-${line.id}`}><QuantityStepper id={`quantity-${line.id}`} value={String(line.plannedQuantity).replace('.', ',')} min={0.001} step={1} disabled={!editable} onChange={(value) => onChange({ ...draft, materials: draft.materials.map((item) => item.id === line.id ? { ...item, plannedQuantity: parseDecimalInput(value) } : item) })} unitLabel={inventoryItems.find((item) => item.id === line.itemId)?.unit} /></Field><div className="flex items-end justify-between gap-3"><label className="flex h-11 items-center gap-2"><Checkbox checked={line.isBillable} disabled={!editable} onCheckedChange={(checked) => onChange({ ...draft, materials: draft.materials.map((item) => item.id === line.id ? { ...item, isBillable: checked === true } : item) })} />Abrechenbar</label>{editable && <Button type="button" size="icon" variant="ghost" onClick={() => onChange({ ...draft, materials: draft.materials.filter((item) => item.id !== line.id) })} aria-label="Material löschen"><Trash2 className="size-4" /></Button>}</div><Field label="Notiz" htmlFor={`material-notes-${line.id}`} className="sm:col-span-2"><Textarea value={line.notes ?? ''} disabled={!editable} onChange={(event) => onChange({ ...draft, materials: draft.materials.map((item) => item.id === line.id ? { ...item, notes: event.target.value || null } : item) })} /></Field></CardContent></Card>)}</section>
}

function CreateMaterialDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (item: InventoryPickerOption) => void }) {
  const [name, setName] = useState(''); const [unit, setUnit] = useState('Stk.'); const [error, setError] = useState<string | null>(null); const { run: runPendingTask, isPending } = usePendingTask();
  function submit(event: React.FormEvent) { event.preventDefault(); event.stopPropagation(); setError(null); void runPendingTask(async () => { const result = await upsertInventoryItem({ name, unit, itemType: 'material', isBillable: true, trackQuantity: true, initialQuantity: 0 }); if (!result.success) { setError('Der Artikel konnte nicht erstellt werden.'); return }; onCreated({ id: result.item.id, itemType: result.item.itemType, name: result.item.name, unit: result.item.unit, internalSku: result.item.internalSku, manufacturer: result.item.manufacturer, supplierName: null, supplierArticleNumber: result.item.supplierArticleNumber, primaryBarcode: null, categoryName: null, isBillable: result.item.isBillable, availableQuantity: 0, stockByLocation: [] }); setName(''); onOpenChange(false) }) }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="contents"><DialogHeader><DialogTitle>Artikel erstellen</DialogTitle><DialogDescription>Der Artikel wird ohne Bestand angelegt.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name" htmlFor="quick-item-name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Einheit" htmlFor="quick-item-unit"><Input value={unit} onChange={(event) => setUnit(event.target.value)} /></Field><ErrorText>{error}</ErrorText></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button><Button type="submit" disabled={isPending}>Erstellen</Button></DialogFooter></form></DialogContent></Dialog>
}

function CapabilitiesEditor({ draft, editable, onChange, capabilities, onCapabilityCreated }: { draft: WorkTemplateDraft; editable: boolean; onChange: (draft: WorkTemplateDraft) => void; capabilities: CapabilityDefinition[]; onCapabilityCreated: (capability: CapabilityDefinition) => void }) {
  function add() { onChange({ ...draft, capabilities: [...draft.capabilities, { id: newId(), capabilityId: '', requireConfirmation: false, sortOrder: draft.capabilities.length }] }) }
  return <section className="space-y-3"><div className="flex items-center justify-between"><div><h3 className="font-semibold">Geplante Qualifikationen</h3><p className="text-sm text-muted-foreground">Bei Aufträgen fließen diese Anforderungen in die bestehende Besetzungsprüfung ein.</p></div>{editable && <Button type="button" size="sm" variant="outline" onClick={add}><Plus className="size-4" />Qualifikation</Button>}</div>{draft.capabilities.map((line) => <div key={line.id} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto]"><SelectWithCreate items={capabilities} getOption={(item) => ({ value: item.id, label: item.name, description: item.kind === 'skill' ? 'Fähigkeit' : 'Zertifizierung' })} value={line.capabilityId} onValueChange={(value) => onChange({ ...draft, capabilities: draft.capabilities.map((item) => item.id === line.id ? { ...item, capabilityId: value } : item) })} createLabel="Neue Qualifikation erstellen" disabled={!editable} renderCreateDialog={(props) => <CreateCapabilityDialog {...props} />} onCreated={onCapabilityCreated} /><label className="flex items-center gap-2"><Checkbox checked={line.requireConfirmation} disabled={!editable} onCheckedChange={(checked) => onChange({ ...draft, capabilities: draft.capabilities.map((item) => item.id === line.id ? { ...item, requireConfirmation: checked === true } : item) })} />Bestätigung nötig</label>{editable && <Button type="button" size="icon" variant="ghost" onClick={() => onChange({ ...draft, capabilities: draft.capabilities.filter((item) => item.id !== line.id) })} aria-label="Qualifikation löschen"><Trash2 className="size-4" /></Button>}</div>)}</section>
}

function CreateCapabilityDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (item: CapabilityDefinition) => void }) {
  const [name, setName] = useState(''); const [kind, setKind] = useState<CapabilityKind>('skill'); const [error, setError] = useState<string | null>(null); const { run: runPendingTask, isPending } = usePendingTask();
  function submit(event: React.FormEvent) { event.preventDefault(); event.stopPropagation(); void runPendingTask(async () => { const result = await createCapability({ name, kind }); if (!result.success || !result.capabilityId) { setError('Die Qualifikation konnte nicht erstellt werden.'); return }; onCreated({ id: result.capabilityId, organizationId: '', kind, name: name.trim(), description: null, defaultExpiryWarningDays: kind === 'certification' ? 30 : 0, retiredAt: null }); setName(''); onOpenChange(false) }) }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="contents"><DialogHeader><DialogTitle>Qualifikation erstellen</DialogTitle><DialogDescription>Erweitert den gemeinsamen Qualifikationskatalog der Organisation.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name" htmlFor="quick-capability-name"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field><Select value={kind} onValueChange={(value) => setKind(value as CapabilityKind)}><SelectTrigger aria-label="Art der Qualifikation"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="skill">Fähigkeit</SelectItem><SelectItem value="certification">Zertifizierung</SelectItem></SelectContent></Select><ErrorText>{error}</ErrorText></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button><Button type="submit" disabled={isPending}>Erstellen</Button></DialogFooter></form></DialogContent></Dialog>
}
