/**
 * The overflow menu for a record's secondary actions (#214).
 *
 * Three bordered buttons repeated down a register is a wall of controls: the
 * row stops reading as a record and the actions stop reading as a choice.
 * Secondary actions collapse into one control here; a row's primary action,
 * when it has one, stays on the row where a User can reach it without opening
 * anything.
 *
 * Built on the shadcn DropdownMenu, wearing v2 tokens — the same arrangement
 * V2FilterSelect uses, because Radix portals the panel outside `.df-v2`.
 */

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KebabIcon } from "./icons";

export type V2RowMenuItem = {
  label: string;
  /** Ignored on an item with `items`: that one opens its submenu. */
  onSelect: () => void;
  /** A submenu: the item opens these instead of acting itself. */
  items?: V2RowMenuItem[];
  /** Draws the menu's one rule above this item. */
  separatorBefore?: boolean;
  /** A permanent action, marked so it does not read like the others. */
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
};

export type V2RowMenuProps = {
  /** What a screen reader announces, e.g. "Actions on Reconcile import". */
  ariaLabel: string;
  items: V2RowMenuItem[];
  testId?: string;
  /** "ghost" for a trigger that sits on a card rather than in a row. */
  triggerVariant?: "outline" | "ghost";
  triggerClassName?: string;
};

function V2RowMenuEntry({ item, choose }: { item: V2RowMenuItem; choose: (item: V2RowMenuItem) => void }) {
  const separator = item.separatorBefore ? <DropdownMenuSeparator className="df-menu-separator" /> : null;
  if (item.items) {
    return (
      <>
        {separator}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="df-menu-item"
            disabled={item.disabled}
            data-testid={item.testId}
          >
            {item.label}
          </DropdownMenuSubTrigger>
          {/* Portalled like the main panel, so it carries `.df-v2` itself and
              no parent panel's overflow clips it. */}
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="df-v2 df-menu df-row-menu">
              {item.items.map((sub) => (
                <V2RowMenuEntry key={sub.label} item={sub} choose={choose} />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </>
    );
  }
  return (
    <>
      {separator}
      <DropdownMenuItem
        className="df-menu-item"
        data-danger={item.danger ? "true" : "false"}
        disabled={item.disabled}
        data-testid={item.testId}
        onSelect={() => choose(item)}
      >
        {item.label}
      </DropdownMenuItem>
    </>
  );
}

export function V2RowMenu({
  ariaLabel,
  items,
  testId,
  triggerVariant = "outline",
  triggerClassName,
}: V2RowMenuProps) {
  // The chosen item acts once the menu has fully closed. A dialog opened while
  // the menu was still closing kept the page unclickable after it closed
  // (both layers lock the page and the dialog restored the menu's lock).
  const chosen = useRef<V2RowMenuItem | null>(null);
  function choose(item: V2RowMenuItem) {
    chosen.current = item;
  }
  function onCloseAutoFocus() {
    const item = chosen.current;
    chosen.current = null;
    // After Radix has put focus back on the button.
    if (item) window.setTimeout(item.onSelect, 0);
  }

  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={triggerVariant}
          size="icon"
          className={triggerClassName ? `df-btn df-row-menu-trigger ${triggerClassName}` : "df-btn df-row-menu-trigger"}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <KebabIcon />
        </Button>
      </DropdownMenuTrigger>
      {/* Radix portals to document.body, outside `.df-v2`, so the panel
          carries the class itself or the --df-* tokens do not resolve. */}
      <DropdownMenuContent align="end" className="df-v2 df-menu df-row-menu" onCloseAutoFocus={onCloseAutoFocus}>
        {items.map((item) => (
          <V2RowMenuEntry key={item.label} item={item} choose={choose} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
