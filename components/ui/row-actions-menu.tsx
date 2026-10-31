'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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

/** Below the trigger when the items fit there, otherwise above it. */
function menuPosition(bounds: DOMRect, itemCount: number): MenuPosition {
  const estimatedHeight = itemCount * 36 + 16;
  const right = Math.max(8, window.innerWidth - bounds.right);
  return window.innerHeight - bounds.bottom >= estimatedHeight || bounds.top < estimatedHeight
    ? { top: bounds.bottom + 4, right }
    : { bottom: window.innerHeight - bounds.top + 4, right };
}

/** Where the trigger stood when the menu was placed. */
type TriggerAnchor = { top: number; left: number };

/**
 * A scroll event arrives a frame after its scroll: the one that brought the trigger into view
 * before the click (a table scrolled sideways, a momentum scroll) must not close the menu it
 * opened. Only a scroll that moved the trigger away from the placed menu closes it.
 */
function triggerInPlace(trigger: HTMLElement | null, anchor: TriggerAnchor | null): boolean {
  const bounds = trigger?.getBoundingClientRect();
  if (!bounds || !anchor) return false;
  return Math.abs(bounds.top - anchor.top) < 1 && Math.abs(bounds.left - anchor.left) < 1;
}

/** Arrow keys, Home and End move focus between the enabled menu items, wrapping around. */
function moveMenuItemFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
  );
  if (items.length === 0) return;
  const currentIndex = items.findIndex((item) => item === document.activeElement);
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

type CloseMenu = (options?: { restoreFocus?: boolean }) => void;

/** Escape closes and refocuses the trigger, Tab leaves through the trigger, arrows move focus. */
function handleMenuKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  closeMenu: CloseMenu,
): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu({ restoreFocus: true });
    return;
  }

  if (event.key === 'Tab') {
    // Start native traversal from the row trigger, not the body portal.
    // Do not preventDefault: Tab/Shift+Tab must reach the next/previous control.
    triggerRef.current?.focus();
    closeMenu();
    return;
  }

  moveMenuItemFocus(event);
}

type RowActionsMenuTriggerProps = {
  triggerRef: RefObject<HTMLButtonElement | null>;
  menuId: string;
  open: boolean;
  disabled: boolean;
  onToggle: () => void;
  onArrowDown: () => void;
};

function RowActionsMenuTrigger({
  triggerRef,
  menuId,
  open,
  disabled,
  onToggle,
  onArrowDown,
}: RowActionsMenuTriggerProps) {
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-label="Aktionen öffnen"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'h-8 w-8 p-0')}
      disabled={disabled}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        onArrowDown();
      }}
    >
      {disabled ? <Spinner /> : <MoreHorizontal className="size-4" />}
    </button>
  );
}

type RowActionsMenuListProps = {
  menuRef: RefObject<HTMLDivElement | null>;
  menuId: string;
  position: MenuPosition;
  actions: readonly RowActionMenuItem[];
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelectAction: (action: RowActionMenuItem) => void;
};

function RowActionsMenuList({
  menuRef,
  menuId,
  position,
  actions,
  onKeyDown,
  onSelectAction,
}: RowActionsMenuListProps) {
  return (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label="Aktionen"
      // Focusable but not a tab stop, as in the APG menu pattern: focus rests on its items.
      tabIndex={-1}
      style={position}
      className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      onKeyDown={onKeyDown}
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
                'text-destructive focus:bg-destructive/10 focus:text-destructive dark:focus:bg-destructive/20',
            )}
            onClick={() => onSelectAction(action)}
          >
            {action.icon}
            {action.label}
          </button>
        </div>
      ))}
    </div>
  );
}

export function RowActionsMenu({ actions, disabled = false }: RowActionsMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, right: 0 });
  const anchorRef = useRef<TriggerAnchor | null>(null);

  function openMenu(): void {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const bounds = trigger.getBoundingClientRect();
    anchorRef.current = { top: bounds.top, left: bounds.left };
    setPosition(menuPosition(bounds, actions.length));
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

    const handleScroll = (): void => {
      if (!triggerInPlace(triggerRef.current, anchorRef.current)) closeMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  return (
    <>
      <RowActionsMenuTrigger
        triggerRef={triggerRef}
        menuId={menuId}
        open={open}
        disabled={disabled}
        onToggle={() => (open ? closeMenu() : openMenu())}
        onArrowDown={() => {
          if (!open) openMenu();
        }}
      />

      {open &&
        createPortal(
          <RowActionsMenuList
            menuRef={menuRef}
            menuId={menuId}
            position={position}
            actions={actions}
            onKeyDown={(event) => handleMenuKeyDown(event, triggerRef, closeMenu)}
            onSelectAction={(action) => {
              // Restore before the action so a newly opened dialog owns
              // subsequent autofocus. A delayed restoration would steal it.
              triggerRef.current?.focus();
              closeMenu();
              action.onSelect();
            }}
          />,
          document.body,
        )}
    </>
  );
}
