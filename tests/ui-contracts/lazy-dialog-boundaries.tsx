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

type ContractDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; title: string };

declare global {
  interface Window {
    uiContractLazyDialog: {
      /** Downloads the page action's dialog started. */
      loads: number;
      /** Downloads the row menu's dialog started. */
      menuLoads: number;
      /** Answers the open download: the module, or a failed download. */
      answer: ((loaded: boolean) => void) | null;
      /** Answers the row menu's open download with the module. */
      answerMenu: (() => void) | null;
      /** Answers the other row menu dialog's open download with the module. */
      answerOtherMenu: (() => void) | null;
    };
  }
}

export function initializeLazyDialogBoundary(): void {
  window.uiContractLazyDialog = {
    loads: 0,
    menuLoads: 0,
    answer: null,
    answerMenu: null,
    answerOtherMenu: null,
  };
}

function ContractDialog({ open, onOpenChange, title }: ContractDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
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
  const state = window.uiContractLazyDialog;
  state.menuLoads += 1;
  return new Promise((resolve) => {
    state.answerMenu = () => {
      state.answerMenu = null;
      resolve(ContractDialog);
    };
  });
});

// A second lazy dialog, as the project rows open their own edit form beside the job rows.
const otherMenuDialog = lazyDialog<ContractDialogProps>(() => {
  const state = window.uiContractLazyDialog;
  return new Promise((resolve) => {
    state.answerOtherMenu = () => {
      state.answerOtherMenu = null;
      resolve(ContractDialog);
    };
  });
});

/** A list row whose menu opens its edit dialog, as the Aufträge rows do. */
function ContractRow({ name, dialog }: { name: string; dialog: typeof menuDialog }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={name}>
      <RowActionsMenu
        onOpen={dialog.preload}
        disabled={dialog.useWaiting(open)}
        actions={[{ label: 'Bearbeiten', icon: null, onSelect: () => setOpen(true) }]}
      />
      <dialog.Dialog open={open} onOpenChange={setOpen} title={`${name} bearbeiten`} />
    </section>
  );
}

function PageContent(): ReactElement {
  const { open, setOpen } = usePageAction();
  usePageActionLoader(pageDialog.preload, pageDialog.useWaiting(open));
  return (
    <>
      <ContractRow name="Erste Zeile" dialog={menuDialog} />
      <ContractRow name="Zweite Zeile" dialog={menuDialog} />
      <ContractRow name="Projektzeile" dialog={otherMenuDialog} />
      <pageDialog.Dialog open={open} onOpenChange={setOpen} title="Geladener Dialog" />
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
