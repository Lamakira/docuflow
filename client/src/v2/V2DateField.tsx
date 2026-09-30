import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateToDay, dayToDate, formatFullDate, type DayRange } from "./dates";

/**
 * One date, picked on the shadcn Calendar in a Popover (#307). The trigger
 * reads the day in full; Clear empties it.
 */
export function V2DateField({
  value,
  onChange,
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (day: string) => void;
  ariaLabel: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = dayToDate(value);

  function choose(day: string) {
    onChange(day);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          className="df-btn df-date-field"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          <CalendarDays aria-hidden="true" />
          <span>{value ? formatFullDate(value, { dateOnly: true }) : "Not set"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="df-v2 df-select-content df-date-picker">
        {/* `required`: a second click on the chosen day keeps it; Clear empties the field. */}
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (date) choose(dateToDay(date));
          }}
          initialFocus
        />
        {value ? (
          <div className="df-date-picker-foot">
            <Button variant="ghost" type="button" className="df-btn" onClick={() => choose("")}>
              Clear
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A range of days on one shadcn Calendar showing two months (#307): the first
 * click picks the start day, the second the end day, and the range is kept.
 */
export function V2DateRangeField({
  value,
  onChange,
  ariaLabel,
  testId,
}: {
  value: DayRange | null;
  onChange: (range: DayRange) => void;
  ariaLabel: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Date | null>(null);
  const saved: DateRange | undefined = value ? { from: dayToDate(value.from), to: dayToDate(value.to) } : undefined;
  const selected: DateRange | undefined = start ? { from: start, to: undefined } : saved;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStart(null);
  }

  function pick(day: Date) {
    if (!start) {
      setStart(day);
      return;
    }
    const [from, to] = day < start ? [day, start] : [start, day];
    onChange({ from: dateToDay(from), to: dateToDay(to) });
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" type="button" className="df-btn df-date-field" aria-label={ariaLabel} data-testid={testId}>
          <CalendarDays aria-hidden="true" />
          <span>
            {value
              ? `${formatFullDate(value.from, { dateOnly: true })} – ${formatFullDate(value.to, { dateOnly: true })}`
              : "Pick a range"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="df-v2 df-select-content df-date-picker">
        <Calendar
          mode="range"
          numberOfMonths={2}
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(_range, day) => pick(day)}
          initialFocus
        />
        <p className="df-date-picker-foot df-mono df-meta">
          {start ? "Now pick the end day." : "Pick the start day, then the end day."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
