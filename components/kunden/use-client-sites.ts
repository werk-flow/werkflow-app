'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useBanner } from '@/components/ui/banner';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { createClientSite, updateClientSite } from '@/lib/clients/actions';
import { buildSiteEcho, withPendingPrimary } from '@/lib/clients/relation-echo';
import type { ClientSite } from '@/lib/clients/types';

import { EMPTY_SITE, errorMessage, getRelationId, type SiteDialogState } from './client-relation-drafts';
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
  const { runRowTask, settleRow } = rowTasks;
  const siteList = useOptimisticList({ items: sites, getId: getRelationId });
  const waitForSites = useSettleOnChange(sites);
  const { showBanner } = useBanner();
  const [siteDialog, setSiteDialog] = useState<SiteDialogState | null>(null);

  const shownSites = withPendingPrimary(siteList.items);
  const activeSites = shownSites.filter((site) => site.isActive);
  const inactiveSites = shownSites.filter((site) => !site.isActive);

  function openNewSite(): void {
    setSiteDialog({
      siteId: null,
      draft: { ...EMPTY_SITE, isPrimary: activeSites.length === 0 },
      error: null,
    });
  }

  function openSiteEditor(site: ClientSite): void {
    setSiteDialog({
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
    });
  }

  function adoptAddressAsSite(): void {
    if (!clientAddress) return;
    setSiteDialog({
      siteId: null,
      draft: {
        ...EMPTY_SITE,
        name: 'Hauptstandort',
        street: clientAddress,
        isPrimary: activeSites.length === 0,
      },
      error: null,
    });
  }

  function saveSite(): void {
    if (!siteDialog) return;
    if (!siteDialog.draft.name.trim()) {
      setSiteDialog({ ...siteDialog, nameError: 'Bitte gib eine Bezeichnung ein.' });
      document.getElementById('site-name')?.focus();
      return;
    }
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
        setSiteDialog({ siteId, draft, error: errorMessage(result.error) });
        return;
      }
      showBanner({ variant: 'success', message: 'Einsatzort gespeichert.' });
      if (stored) return settleRow(siteList, echoId, waitForSites);
      siteList.commit(echoId, result.site);
      router.refresh();
    })();
  }

  function toggleSiteActive(site: ClientSite): void {
    setSectionError(null);
    siteList.update(site.id, { ...site, isActive: !site.isActive });
    void runRowTask(site.id, async () => {
      const result = await updateClientSite(site.id, {
        isActive: !site.isActive,
      }).catch(() => ({ success: false as const, error: 'unexpected_error' }));
      if (!result.success) {
        siteList.rollback(site.id);
        setSectionError(errorMessage(result.error));
        return;
      }
      await settleRow(siteList, site.id, waitForSites);
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
