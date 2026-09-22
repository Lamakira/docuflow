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

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KebabIcon } from "./icons";

export type V2RowMenuItem = {
  label: string;
  onSelect: () => void;
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
};

export function V2RowMenu({ ariaLabel, items, testId }: V2RowMenuProps) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="df-btn df-row-menu-trigger"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <KebabIcon />
        </Button>
      </DropdownMenuTrigger>
      {/* Radix portals to document.body, outside `.df-v2`, so the panel
          carries the class itself or the --df-* tokens do not resolve. */}
      <DropdownMenuContent align="end" className="df-v2 df-menu df-row-menu">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className="df-menu-item"
            data-danger={item.danger ? "true" : "false"}
            disabled={item.disabled}
            data-testid={item.testId}
            onSelect={item.onSelect}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
