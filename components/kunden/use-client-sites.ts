'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { createClientSite, updateClientSite } from '@/lib/clients/actions';
import { buildSiteEcho, withPendingPrimary } from '@/lib/clients/relation-echo';
import type { ClientSite } from '@/lib/clients/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

import {
  EMPTY_SITE,
  clientRelationErrorMessage,
  getRelationId,
  type SiteDialogState,
} from './client-relation-drafts';
import { toggleRelationActive } from './toggle-relation-active';
import type { RelationRowTasks } from './use-relation-row-tasks';

interface ClientSitesState {
  activeSites: ClientSite[];
  inactiveSites: ClientSite[];
  isOptimistic: (id: string) => boolean;
  siteDialog: SiteDialogState | null;
  setSiteDialog: (next: SiteDialogState | null) => void;
  openNewSite: () => void;
  openSiteEditor: (site: ClientSite) => void;
  adoptAddressAsSite: () => void;
  saveSite: () => void;
  toggleSiteActive: (site: ClientSite) => void;
}

/** A new site's dialog; the first active site starts as the primary one. */
function newSiteDialogState(isPrimary: boolean): SiteDialogState {
  return { siteId: null, draft: { ...EMPTY_SITE, isPrimary }, error: null };
}

/** The dialog with its name error when the name is missing, after focusing the field; null when valid. */
function siteDialogWithNameError(siteDialog: SiteDialogState): SiteDialogState | null {
  const nameError = siteDialog.draft.name.trim() ? undefined : 'Bitte gib eine Bezeichnung ein.';
  if (!focusFirstInvalidField({ 'site-name': nameError })) return null;
  return { ...siteDialog, nameError: nameError ?? null };
}

/** The dialog of a stored site, its draft filled from the site. */
function siteEditorDialogState(site: ClientSite): SiteDialogState {
  return {
    siteId: site.id,
    draft: {
      name: site.name,
      street: site.street ?? '',
      postalCode: site.postalCode ?? '',
      city: site.city ?? '',
      accessNotes: site.accessNotes ?? '',
      notes: site.notes ?? '',
      primaryContactId: site.primaryContactId,
      isPrimary: site.isPrimary,
    },
    error: null,
  };
}

/** A new site's dialog prefilled with the customer's address as its main location. */
function adoptedAddressDialogState(clientAddress: string, isPrimary: boolean): SiteDialogState {
  return {
    siteId: null,
    draft: {
      ...EMPTY_SITE,
      name: 'Hauptstandort',
      street: clientAddress,
      isPrimary,
    },
    error: null,
  };
}

/** The optimistic work-site list of one customer with its dialog and row actions. */
export function useClientSites({
  clientId,
  clientAddress,
  sites,
  rowTasks,
  setSectionError,
}: {
  clientId: string;
  clientAddress: string | null;
  sites: ClientSite[];
  rowTasks: RelationRowTasks;
  setSectionError: (error: string | null) => void;
}): ClientSitesState {
  const router = useRouter();
  const { settleRow } = rowTasks;
  const siteList = useOptimisticList({ items: sites, getId: getRelationId });
  const waitForSites = useSettleOnChange(sites);
  const { showBanner } = useBanner();
  const [siteDialog, setSiteDialog] = useState<SiteDialogState | null>(null);

  const shownSites = withPendingPrimary(siteList.items);
  const activeSites = shownSites.filter((site) => site.isActive);
  const inactiveSites = shownSites.filter((site) => !site.isActive);

  function openNewSite(): void {
    setSiteDialog(newSiteDialogState(activeSites.length === 0));
  }

  function openSiteEditor(site: ClientSite): void {
    setSiteDialog(siteEditorDialogState(site));
  }

  function adoptAddressAsSite(): void {
    if (!clientAddress) return;
    setSiteDialog(adoptedAddressDialogState(clientAddress, activeSites.length === 0));
  }

  function saveSite(): void {
    if (!siteDialog) return;
    const invalidDialog = siteDialogWithNameError(siteDialog);
    if (invalidDialog) return setSiteDialog(invalidDialog);
    const { siteId, draft } = siteDialog;
    const stored = sites.find((site) => site.id === siteId);
    const echoId = stored?.id ?? `pending-${crypto.randomUUID()}`;
    const echo = buildSiteEcho(stored ?? { id: echoId, clientId }, draft);
    if (stored) siteList.update(echoId, echo);
    else siteList.insert(echoId, echo);
    setSiteDialog(null);
    void (async () => {
      const result = await (
        stored ? updateClientSite(stored.id, draft) : createClientSite(clientId, draft)
      ).catch(() => ({ success: false as const, error: 'unexpected_error' }));

      if (!result.success) {
        siteList.rollback(echoId);
        setSiteDialog({ siteId, draft, error: clientRelationErrorMessage(result.error) });
        return;
      }
      showBanner({ variant: 'success', message: 'Einsatzort gespeichert.' });
      if (stored) return settleRow(siteList, echoId, waitForSites);
      siteList.commit(echoId, result.site);
      router.refresh();
    })();
  }

  function toggleSiteActive(site: ClientSite): void {
    toggleRelationActive(site, {
      list: siteList,
      rowTasks,
      waitForRows: waitForSites,
      setSectionError,
      saveIsActive: (siteId, isActive) => updateClientSite(siteId, { isActive }),
    });
  }

  return {
    activeSites,
    inactiveSites,
    isOptimistic: siteList.isOptimistic,
    siteDialog,
    setSiteDialog,
    openNewSite,
    openSiteEditor,
    adoptAddressAsSite,
    saveSite,
    toggleSiteActive,
  };
}
