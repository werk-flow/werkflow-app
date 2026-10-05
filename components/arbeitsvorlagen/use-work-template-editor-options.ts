'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { upsertInventoryItem } from '@/lib/inventory/actions';
import type { InventoryPickerOption } from '@/lib/inventory/types';
import { createCapability } from '@/lib/qualifications/actions';
import type { CapabilityDefinition } from '@/lib/qualifications/types';
import type { WorkTemplateDetail, WorkTemplateDraft } from '@/lib/work-templates/types';

import {
  getId,
  newId,
  type CreateCapabilityInput,
  type CreateInventoryItemInput,
} from './work-template-editor-shared';

type WorkTemplateEditorOptionsInput = {
  detail: WorkTemplateDetail | null;
  draft: WorkTemplateDraft | null;
  setDraft: Dispatch<SetStateAction<WorkTemplateDraft | null>>;
  inventoryItems: InventoryPickerOption[];
  capabilities: CapabilityDefinition[];
};

type WorkTemplateEditorOptions = {
  activeDraft: WorkTemplateDraft | null;
  inventoryItemOptions: InventoryPickerOption[];
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
  inventoryItems,
  capabilities,
}: WorkTemplateEditorOptionsInput): WorkTemplateEditorOptions {
  const { showBanner } = useBanner();
  // Quick-created options overlay the server-provided catalogs; `optionBusy` is keyed by the temporary id
  // the line holds until the server confirms, so the line's own indicator clears with the id swap.
  const inventoryOptions = useOptimisticList({ items: inventoryItems, getId });
  const capabilityOptions = useOptimisticList({ items: capabilities, getId });
  const optionBusy = useBusyIds();
  const inventoryItemOptions = useMemo(
    () => inventoryOptions.items.map((entry) => entry.item),
    [inventoryOptions.items],
  );
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
    const pendingItem: InventoryPickerOption = {
      id: tempId,
      itemType: 'material',
      name: input.name.trim(),
      unit: input.unit.trim(),
      internalSku: null,
      manufacturer: null,
      supplierName: null,
      supplierArticleNumber: null,
      primaryBarcode: null,
      categoryName: null,
      isBillable: true,
      availableQuantity: 0,
      stockByLocation: [],
    };
    inventoryOptions.insert(tempId, pendingItem);
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
        inventoryOptions.rollback(tempId);
        resolveOptionId(tempId, '');
        showBanner({
          variant: 'error',
          message: `Der Artikel „${pendingItem.name}“ konnte nicht erstellt werden. Bitte versuche es erneut.`,
        });
        return;
      }
      const item = result.item;
      inventoryOptions.commit(tempId, {
        ...pendingItem,
        id: item.id,
        name: item.name,
        unit: item.unit,
        internalSku: item.internalSku,
        manufacturer: item.manufacturer,
        supplierArticleNumber: item.supplierArticleNumber,
        isBillable: item.isBillable,
      });
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
    inventoryItemOptions,
    capabilityItemOptions,
    optionBusy,
    patchDraft,
    resetResolvedOptionIds,
    createInventoryItem,
    createCapabilityOption,
  };
}
