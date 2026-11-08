// A dialog that loads on demand (`lazyDialog`), with a download the spec answers:
// the contract observes the opener between its intent, the click and the module.
import { useState, type ReactElement } from 'react';
import { lazyDialog } from '@/components/shared/lazy-dialog';
import {
  PageActionButton,
  PageActionProvider,
  usePageAction,
  usePageActionLoader,
} from '@/components/shared/page-action';
import { BannerProvider } from '@/components/ui/banner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';

type ContractDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

declare global {
  interface Window {
    uiContractLazyDialog: {
      /** Downloads the page action's dialog started. */
      loads: number;
      /** Downloads the row menu's dialog started. */
      menuLoads: number;
      /** Answers the open download: the module, or a failed download. */
      answer: ((loaded: boolean) => void) | null;
    };
  }
}

export function initializeLazyDialogBoundary(): void {
  window.uiContractLazyDialog = { loads: 0, menuLoads: 0, answer: null };
}

function ContractDialog({ open, onOpenChange }: ContractDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Geladener Dialog</DialogTitle>
        <DialogDescription>Das Modul ist da.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

const pageDialog = lazyDialog<ContractDialogProps>(() => {
  const state = window.uiContractLazyDialog;
  state.loads += 1;
  return new Promise((resolve, reject) => {
    state.answer = (loaded) => {
      state.answer = null;
      if (loaded) resolve(ContractDialog);
      else reject(new Error('chunk download failed'));
    };
  });
});

const menuDialog = lazyDialog<ContractDialogProps>(() => {
  window.uiContractLazyDialog.menuLoads += 1;
  return Promise.resolve(ContractDialog);
});

function PageContent(): ReactElement {
  const { open, setOpen } = usePageAction();
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  usePageActionLoader(pageDialog.preload, pageDialog.useWaiting(open));
  return (
    <>
      <RowActionsMenu
        onOpen={menuDialog.preload}
        actions={[{ label: 'Bearbeiten', icon: null, onSelect: () => setMenuDialogOpen(true) }]}
      />
      <pageDialog.Dialog open={open} onOpenChange={setOpen} />
      <menuDialog.Dialog open={menuDialogOpen} onOpenChange={setMenuDialogOpen} />
    </>
  );
}

export function LazyDialogContractFixture(): ReactElement {
  return (
    <BannerProvider>
      <PageActionProvider>
        <main>
          <h1>Komponentenverträge</h1>
          <PageActionButton>Neu</PageActionButton>
          <PageContent />
        </main>
      </PageActionProvider>
    </BannerProvider>
  );
}
