'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { upsertInventoryItem } from '@/lib/inventory/actions';
import { createCapability } from '@/lib/qualifications/actions';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import type { WorkTemplateDetail, WorkTemplateDraft } from '@/lib/work-templates/types';

import {
  getId,
  newId,
  type CreateCapabilityInput,
  type CreateInventoryItemInput,
  type CreatedInventoryItem,
} from './work-template-editor-shared';

type WorkTemplateEditorOptionsInput = {
  detail: WorkTemplateDetail | null;
  draft: WorkTemplateDraft | null;
  setDraft: Dispatch<SetStateAction<WorkTemplateDraft | null>>;
  capabilities: CapabilityDefinition[];
};

type WorkTemplateEditorOptions = {
  activeDraft: WorkTemplateDraft | null;
  /** Articles quick-created in this editor; the line pickers search the catalog on the server. */
  createdInventoryItems: CreatedInventoryItem[];
  capabilityItemOptions: CapabilityDefinition[];
  optionBusy: ReturnType<typeof useBusyIds>;
  patchDraft: (patch: (current: WorkTemplateDraft) => WorkTemplateDraft) => void;
  resetResolvedOptionIds: () => void;
  createInventoryItem: (lineId: string, input: CreateInventoryItemInput) => void;
  createCapabilityOption: (lineId: string, input: CreateCapabilityInput) => void;
};

/**
 * The editor's quick-create catalogs and the draft as read through confirmed option ids.
 * The draft state itself stays with the dialog; this hook only reads and patches it.
 */
export function useWorkTemplateEditorOptions({
  detail,
  draft,
  setDraft,
  capabilities,
}: WorkTemplateEditorOptionsInput): WorkTemplateEditorOptions {
  const { showBanner } = useBanner();
  // A quick-created article joins the line's server search locally; the row its save returns
  // confirms it. Capabilities overlay the server-provided catalog. `optionBusy` is keyed by the
  // temporary id the line holds until the server confirms, so the line's indicator clears with the id swap.
  const [createdInventoryItems, setCreatedInventoryItems] = useState<CreatedInventoryItem[]>([]);
  const capabilityOptions = useOptimisticList({ items: capabilities, getId });
  const optionBusy = useBusyIds();
  const capabilityItemOptions = useMemo(
    () => capabilityOptions.items.map((entry) => entry.item),
    [capabilityOptions.items],
  );
  // Temporary option id -> confirmed id ('' after a failed create). The draft is read through this map
  // instead of being rewritten once: an editor change still holding the pre-confirmation draft would put
  // the temporary id back, and the save would then send an id the catalog never had.
  const [resolvedOptionIds, setResolvedOptionIds] = useState<ReadonlyMap<string, string>>(() => new Map());
  const storedDraft = draft ?? detail?.draft ?? null;
  const activeDraft = useMemo(() => {
    if (!storedDraft || resolvedOptionIds.size === 0) return storedDraft;
    return {
      ...storedDraft,
      materials: storedDraft.materials.map((line) =>
        resolvedOptionIds.has(line.itemId)
          ? { ...line, itemId: resolvedOptionIds.get(line.itemId) ?? '' }
          : line,
      ),
      capabilities: storedDraft.capabilities.map((line) =>
        resolvedOptionIds.has(line.capabilityId)
          ? { ...line, capabilityId: resolvedOptionIds.get(line.capabilityId) ?? '' }
          : line,
      ),
    };
  }, [storedDraft, resolvedOptionIds]);

  // Functional draft patch for async confirmations: the user may have kept typing meanwhile.
  function patchDraft(patch: (current: WorkTemplateDraft) => WorkTemplateDraft) {
    setDraft((current) => {
      const base = current ?? detail?.draft ?? null;
      return base ? patch(base) : current;
    });
  }
  function resolveOptionId(tempId: string, confirmedId: string) {
    setResolvedOptionIds((current) => new Map(current).set(tempId, confirmedId));
  }
  function resetResolvedOptionIds() {
    setResolvedOptionIds(new Map());
  }
  function createInventoryItem(lineId: string, input: CreateInventoryItemInput) {
    const tempId = newId();
    const pendingItem: CreatedInventoryItem = {
      id: tempId,
      name: input.name.trim(),
      unit: input.unit.trim(),
      internalSku: null,
      isBillable: true,
    };
    setCreatedInventoryItems((current) => [...current, pendingItem]);
    patchDraft((current) => ({
      ...current,
      materials: current.materials.map((line) =>
        line.id === lineId ? { ...line, itemId: tempId, isBillable: true } : line,
      ),
    }));
    void optionBusy.run(tempId, async () => {
      const result = await upsertInventoryItem({
        name: pendingItem.name,
        unit: pendingItem.unit,
        itemType: 'material',
        isBillable: true,
        trackQuantity: true,
        initialQuantity: 0,
      }).catch(() => null);
      if (!result?.success) {
        setCreatedInventoryItems((current) => current.filter((created) => created.id !== tempId));
        resolveOptionId(tempId, '');
        showBanner({
          variant: 'error',
          message: `Der Artikel „${pendingItem.name}“ konnte nicht erstellt werden. Bitte versuche es erneut.`,
        });
        return;
      }
      const item = result.item;
      const confirmed: CreatedInventoryItem = {
        id: item.id,
        name: item.name,
        unit: item.unit,
        internalSku: item.internalSku,
        isBillable: item.isBillable,
      };
      setCreatedInventoryItems((current) =>
        current.map((created) => (created.id === tempId ? confirmed : created)),
      );
      resolveOptionId(tempId, item.id);
    });
  }
  function createCapabilityOption(lineId: string, input: CreateCapabilityInput) {
    const tempId = newId();
    const pendingCapability: CapabilityDefinition = {
      id: tempId,
      organizationId: '',
      kind: input.kind,
      name: input.name.trim(),
      description: null,
      defaultExpiryWarningDays: input.kind === 'certification' ? 30 : 0,
      retiredAt: null,
    };
    capabilityOptions.insert(tempId, pendingCapability);
    patchDraft((current) => ({
      ...current,
      capabilities: current.capabilities.map((line) =>
        line.id === lineId ? { ...line, capabilityId: tempId } : line,
      ),
    }));
    void optionBusy.run(tempId, async () => {
      const result = await createCapability({ name: pendingCapability.name, kind: input.kind }).catch(
        () => null,
      );
      if (!result?.success || !result.capabilityId) {
        capabilityOptions.rollback(tempId);
        resolveOptionId(tempId, '');
        showBanner({
          variant: 'error',
          message: `Die Qualifikation „${pendingCapability.name}“ konnte nicht erstellt werden. Bitte versuche es erneut.`,
        });
        return;
      }
      const capabilityId = result.capabilityId;
      capabilityOptions.commit(tempId, { ...pendingCapability, id: capabilityId });
      resolveOptionId(tempId, capabilityId);
    });
  }

  return {
    activeDraft,
    createdInventoryItems,
    capabilityItemOptions,
    optionBusy,
    patchDraft,
    resetResolvedOptionIds,
    createInventoryItem,
    createCapabilityOption,
  };
}
