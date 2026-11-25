import { Checkbox } from "@/components/ui/checkbox";

/** A narrowing filter drawn as a chip: the shadcn Checkbox with its label. */
export function FilterCheck({
  id,
  checked,
  disabled,
  label,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="df-filter-chip df-gallery-filter" data-active={checked ? "true" : "false"}>
      <div className="df-checkbox-row" data-disabled={disabled ? "true" : "false"}>
        <Checkbox
          id={id}
          className="df-checkbox"
          checked={checked}
          disabled={disabled}
          onCheckedChange={(next) => onChange(next === true)}
        />
        <label htmlFor={id}>{label}</label>
      </div>
    </div>
  );
}
