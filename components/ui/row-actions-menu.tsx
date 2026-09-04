'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, MoreHorizontal } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type RowActionMenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  variant?: 'default' | 'destructive';
  separatorBefore?: boolean;
};

type RowActionsMenuProps = {
  actions: readonly RowActionMenuItem[];
  disabled?: boolean;
};

type MenuPosition = Pick<CSSProperties, 'top' | 'right' | 'bottom'>;

export function RowActionsMenu({ actions, disabled = false }: RowActionsMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, right: 0 });

  function openMenu(): void {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    const estimatedHeight = actions.length * 36 + 16;
    const right = Math.max(8, window.innerWidth - bounds.right);

    setPosition(
      window.innerHeight - bounds.bottom >= estimatedHeight || bounds.top < estimatedHeight
        ? { top: bounds.bottom + 4, right }
        : { bottom: window.innerHeight - bounds.top + 4, right }
    );
    setOpen(true);
  }

  function closeMenu({ restoreFocus = false } = {}): void {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    }

    function handleViewportChange(): void {
      closeMenu();
    }

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open]);

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1 + items.length) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Aktionen öffnen"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 w-8 p-0')}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          if (!open) openMenu();
        }}
      >
        {disabled ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Aktionen"
            style={position}
            className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
            onKeyDown={handleMenuKeyDown}
          >
            {actions.map((action) => (
              <div key={action.label}>
                {action.separatorBefore && <div role="separator" className="-mx-1 my-1 h-px bg-border" />}
                <button
                  type="button"
                  role="menuitem"
                  className={cn(
                    'relative flex w-full cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none focus:bg-accent focus:text-accent-foreground',
                    action.variant === 'destructive' &&
                      'text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20'
                  )}
                  onClick={() => {
                    closeMenu();
                    action.onSelect();
                  }}
                >
                  {action.icon}
                  {action.label}
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
