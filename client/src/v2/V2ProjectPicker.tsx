import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ProjectPickerOption = {
  id: string;
  label: string;
  /** The muted line under the label; searched too. */
  meta?: string | null;
};

export type V2ProjectPickerProps = {
  options: ProjectPickerOption[];
  /** The chosen option's id; "" for none. */
  value: string;
  onChange: (id: string) => void;
  /** What the trigger reads when `value` is in no option. */
  valueLabel?: string;
  /** `field` spans its form; `chip` sits in a filter bar or a toolbar, with `label` as its prefix. */
  variant?: "field" | "chip";
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Draws the chip in ink, for a filter that is narrowing the register. */
  active?: boolean;
  /** Inside a Dialog. */
  modal?: boolean;
  state?: "ready" | "loading" | "failed";
  testId?: string;
};

/** Choosing a Project among many: a shadcn Popover and Command, searched by name or Client. */
export function V2ProjectPicker({
  options,
  value,
  onChange,
  valueLabel = "Choose a Project",
  variant = "field",
  label,
  ariaLabel = "Project",
  disabled,
  active,
  modal = false,
  state = "ready",
  testId,
}: V2ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.id === value);
  const text = chosen?.label ?? valueLabel;
  return (
    <Popover modal={modal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          className={
            variant === "chip"
              ? "df-filter-chip df-select-trigger df-project-picker-chip"
              : "df-btn df-project-picker-trigger"
          }
          role="combobox"
          aria-expanded={open}
          aria-label={value || chosen ? `${ariaLabel}: ${text}` : ariaLabel}
          data-active={active ? "true" : "false"}
          disabled={disabled}
          data-testid={testId}
        >
          {label ? <span className="df-select-prefix">{label}</span> : null}
          <span className="df-project-picker-value">{text}</span>
          <ChevronDown strokeWidth={1.6} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="df-v2 df-select-content df-project-picker" data-variant={variant}>
        <Command
          defaultValue={chosen?.id}
          filter={(_value, search, keywords) =>
            (keywords ?? []).join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search Projects" aria-label="Search Projects" />
          <CommandList>
            <CommandEmpty>
              {state === "loading"
                ? "Loading Projects."
                : state === "failed"
                  ? "The Projects could not be loaded."
                  : "No Project matches."}
            </CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                keywords={[option.label, option.meta ?? ""]}
                className="df-select-item"
                onSelect={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
              >
                <span className="df-project-picker-option">
                  <span>{option.label}</span>
                  {option.meta ? <span className="df-meta">{option.meta}</span> : null}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
