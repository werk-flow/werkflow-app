'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { PlainButton } from '@/components/ui/plain-button';
import { EmptyState } from '@/components/ui/empty-state';
import { useMemo, useState, type ReactElement } from 'react';
import { useServerAction } from '@/hooks/use-server-action';
import { Archive, ClipboardList, Plus, RotateCcw } from 'lucide-react';

import { usePageAction } from '@/components/shared/page-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { readInBackground } from '@/lib/data/background-read-client';
import type { InventoryLocation } from '@/lib/inventory/types';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import { cn } from '@/lib/utils';
import { createWorkTemplate, setWorkTemplateArchived } from '@/lib/work-templates/actions';
import type {
  WorkTemplateDetail,
  WorkTemplateSummary,
  WorkTemplateTargetType,
} from '@/lib/work-templates/types';

import { CreateTemplateDialog } from './create-work-template-dialog';
import { TemplateEditorDialog } from './work-template-editor-dialog';
import { ERROR_MESSAGES, getId, newId, type CreateTemplateInput } from './work-template-editor-shared';

type Props = {
  initialTemplates: WorkTemplateSummary[];
  inventoryLocations: InventoryLocation[];
  capabilities: CapabilityDefinition[];
};

type TargetFilter = 'all' | WorkTemplateTargetType;
type StatusFilter = 'active' | 'draft' | 'published' | 'archived';

// Mirrors the server list order (`updated_at desc`), so an optimistic draft lands at the top.
function byUpdatedAtDesc(a: WorkTemplateSummary, b: WorkTemplateSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function WorkTemplatesContent({
  initialTemplates,
  inventoryLocations,
  capabilities,
}: Props): ReactElement {
  const [search, setSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  // The create button lives in the page header outside the data boundary.
  const { open: createOpen, setOpen: setCreateOpen } = usePageAction();
  const [editing, setEditing] = useState<WorkTemplateDetail | null>(null);
  // Row-scoped pending: opening or archiving one template leaves the other rows usable.
  const busy = useBusyIds();
  const { run: runCreate } = useServerAction(createWorkTemplate);
  const { showBanner } = useBanner();

  // Reads over GET, outside the Server Action queue the create and archive saves use.
  const view = useLiveView<WorkTemplateSummary[]>({
    tables: ['work_templates', 'work_template_versions', 'work_template_applications'],
    read: async ({ signal }): Promise<LiveViewResult<WorkTemplateSummary[]>> => {
      const result = await readInBackground('work-templates', {}, signal);
      return result.success ? { ok: true, data: result.data } : { ok: false };
    },
    initialData: initialTemplates,
  });
  const templates = view.data ?? initialTemplates;
  const reload = view.refresh;
  const list = useOptimisticList({ items: templates, getId, compare: byUpdatedAtDesc });

  const filtered = useMemo(
    () =>
      list.items.filter(({ item: template }) => {
        const query = search.trim().toLocaleLowerCase('de');
        if (
          query &&
          !`${template.name} ${template.description ?? ''}`.toLocaleLowerCase('de').includes(query)
        )
          return false;
        if (targetFilter !== 'all' && template.targetType !== targetFilter) return false;
        if (statusFilter === 'active' && template.archivedAt) return false;
        if (statusFilter === 'archived' && !template.archivedAt) return false;
        if (statusFilter === 'draft' && (template.status !== 'draft' || template.archivedAt)) return false;
        if (statusFilter === 'published' && (!template.currentPublishedVersionId || template.archivedAt))
          return false;
        return true;
      }),
    [search, statusFilter, targetFilter, list.items],
  );

  function openEditor(templateId: string) {
    void busy.run(templateId, async () => {
      const result = await readInBackground('work-template-detail', { templateId });
      if (!result.success) {
        showBanner({ variant: 'error', message: 'Die Arbeitsvorlage konnte nicht geladen werden.' });
        return;
      }
      setEditing(result.data);
    });
  }

  function changeArchive(template: WorkTemplateSummary) {
    void busy.run(template.id, async () => {
      const archived = !template.archivedAt;
      const result = await setWorkTemplateArchived(template.id, archived).catch(() => null);
      if (!result?.success) {
        showBanner({ variant: 'error', message: 'Der Archivstatus konnte nicht geändert werden.' });
        return;
      }
      await reload();
      showBanner({
        variant: 'success',
        message: archived ? 'Arbeitsvorlage archiviert.' : 'Arbeitsvorlage reaktiviert.',
      });
    });
  }

  // The dialog has already closed; the new draft shows as a dimmed row until the live view carries it.
  async function createTemplate(input: CreateTemplateInput): Promise<void> {
    const tempId = newId();
    const draft: WorkTemplateSummary = {
      id: tempId,
      targetType: input.targetType,
      archivedAt: null,
      draftVersionId: null,
      currentPublishedVersionId: null,
      name: input.name.trim(),
      description: input.description.trim() || null,
      versionNumber: 1,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    };
    view.invalidate();
    list.insert(tempId, draft);
    const result = await runCreate(input).catch(() => null);
    if (!result?.success) {
      list.rollback(tempId);
      showBanner({
        variant: 'error',
        message:
          result?.error === 'not_authorized'
            ? ERROR_MESSAGES.not_authorized
            : `„${draft.name}“ konnte nicht erstellt werden. Bitte versuche es erneut.`,
      });
      return;
    }
    list.commit(tempId, { ...draft, id: result.data.templateId });
    await reload();
    showBanner({ variant: 'success', message: 'Arbeitsvorlage wurde erstellt.' });
    openEditor(result.data.templateId);
  }

  return (
    <div className="space-y-6">
      <WorkTemplateFilters
        search={search}
        onSearchChange={setSearch}
        targetFilter={targetFilter}
        onTargetFilterChange={setTargetFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <StaleRegion stale={view.isStale} onRetry={reload}>
        {list.items.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Noch keine Arbeitsvorlagen"
            description="Lege eine Vorlage für einen wiederkehrenden Auftrag oder ein Projekt an. WerkFlow bringt keine fertigen Standardvorlagen mit."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Erste Vorlage erstellen
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Keine Arbeitsvorlagen gefunden"
            description="Keine Arbeitsvorlage passt zu Suche und Filtern."
          />
        ) : (
          <div className="space-y-3">
            {filtered.map(({ item: template, isOptimistic }) => (
              <WorkTemplateRow
                key={template.id}
                template={template}
                isOptimistic={isOptimistic}
                pending={isOptimistic || busy.isBusy(template.id)}
                onOpen={openEditor}
                onChangeArchive={changeArchive}
              />
            ))}
          </div>
        )}
      </StaleRegion>

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => void createTemplate(input)}
      />
      <TemplateEditorDialog
        detail={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        inventoryLocations={inventoryLocations}
        capabilities={capabilities}
        onChanged={async (message) => {
          await reload();
          showBanner({ variant: 'success', message });
        }}
      />
    </div>
  );
}

function WorkTemplateFilters({
  search,
  onSearchChange,
  targetFilter,
  onTargetFilterChange,
  statusFilter,
  onStatusFilterChange,
}: {
  search: string;
  onSearchChange: (search: string) => void;
  targetFilter: TargetFilter;
  onTargetFilterChange: (targetFilter: TargetFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (statusFilter: StatusFilter) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Arbeitsvorlagen suchen" htmlFor="template-search" hideLabel>
        <SearchInput
          value={search}
          onValueChange={onSearchChange}
          placeholder="Arbeitsvorlagen suchen…"
          aria-label="Arbeitsvorlagen suchen"
        />
      </Field>
      <Select value={targetFilter} onValueChange={(value) => onTargetFilterChange(value as TargetFilter)}>
        <SelectTrigger aria-label="Ziel filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Aufträge und Projekte</SelectItem>
          <SelectItem value="job">Nur Aufträge</SelectItem>
          <SelectItem value="project">Nur Projekte</SelectItem>
        </SelectContent>
      </Select>
      <Select value={statusFilter} onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}>
        <SelectTrigger aria-label="Status filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Aktive Vorlagen</SelectItem>
          <SelectItem value="draft">Entwürfe</SelectItem>
          <SelectItem value="published">Veröffentlicht</SelectItem>
          <SelectItem value="archived">Archiv</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function WorkTemplateRow({
  template,
  isOptimistic,
  pending,
  onOpen: openEditor,
  onChangeArchive: changeArchive,
}: {
  template: WorkTemplateSummary;
  isOptimistic: boolean;
  pending: boolean;
  onOpen: (templateId: string) => void;
  onChangeArchive: (template: WorkTemplateSummary) => void;
}) {
  return (
    <Card className={cn('gap-3 py-4', isOptimistic && 'opacity-70')} aria-busy={pending || undefined}>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PlainButton
          type="button"
          className="min-w-0 text-left"
          onClick={() => openEditor(template.id)}
          disabled={pending}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{template.name}</span>
            <Badge variant="outline">{template.targetType === 'job' ? 'Auftrag' : 'Projekt'}</Badge>
            <Badge
              variant={
                template.archivedAt ? 'secondary' : template.status === 'draft' ? 'outline' : 'success'
              }
            >
              {template.archivedAt
                ? 'Archiviert'
                : template.status === 'draft'
                  ? 'Entwurf'
                  : `Version ${template.versionNumber}`}
            </Badge>
            <InlinePending active={pending} label={isOptimistic ? 'Wird erstellt' : 'Wird bearbeitet'} />
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
            {template.description || 'Keine Beschreibung'}
          </p>
        </PlainButton>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => openEditor(template.id)} disabled={pending}>
            Öffnen
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => changeArchive(template)}
            disabled={pending}
            aria-label={template.archivedAt ? 'Arbeitsvorlage reaktivieren' : 'Arbeitsvorlage archivieren'}
          >
            {template.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
