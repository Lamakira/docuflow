/**
 * The v2 filter chip, built on the shadcn Select (#214).
 *
 * v2 reaches for `client/src/components/ui/` before any custom control. The
 * chip shape is the trigger itself, wearing v2 tokens — the pattern
 * V2Administration and V2Clients already use, gathered here so a filter does
 * not have to be spelled out twelve lines at a time.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Radix refuses an empty option value, so a filter that means "nothing chosen
 * yet" carries this sentinel and translates it back at the edge.
 */
export const V2_SELECT_NONE = "none";

export type V2SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type V2FilterSelectProps = {
  /**
   * The mono prefix on the chip, e.g. PROJECT. Empty inside a form field whose
   * own label already names the choice; `ariaLabel` then carries the name.
   */
  label: string;
  /** What a screen reader announces, when the prefix is not a full name. */
  ariaLabel?: string;
  value: string;
  options: V2SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Draws the chip in ink, for a filter that is narrowing the register. */
  active?: boolean;
  testId?: string;
  /** Extra classes on the trigger, for a screen's own motion or layout rule. */
  className?: string;
};

export function V2FilterSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange,
  disabled,
  active,
  testId,
  className,
}: V2FilterSelectProps) {
  // Radix renders the closed panel into a detached fragment and portals the
  // selected item's text into the trigger. Passing the label outright removes
  // that dependency, so a disabled chip still reads what is chosen.
  const chosen = options.find((option) => option.value === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={className ? `df-filter-chip df-select-trigger ${className}` : "df-filter-chip df-select-trigger"}
        aria-label={ariaLabel ?? label}
        data-active={active ? "true" : "false"}
        data-testid={testId}
      >
        {label ? <span className="df-select-prefix">{label}</span> : null}
        <SelectValue>{chosen?.label ?? ""}</SelectValue>
      </SelectTrigger>
      {/* Radix portals to document.body, outside `.df-v2`, so the panel
          carries the class itself or the --df-* tokens do not resolve. */}
      <SelectContent className="df-v2 df-select-content">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="df-select-item"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
