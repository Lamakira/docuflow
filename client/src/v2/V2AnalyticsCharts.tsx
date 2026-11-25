import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Table2 } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Toggle } from "@/components/ui/toggle";
import type { HourPoint, HoursChart, HoursPoint } from "./analytics";
import { formatCount, type StatsChartTable } from "./backOffice";
import { V2CompactEmpty } from "./V2EmptyState";
import { BAR_CURSOR, CHART_MARGIN, ChartTable, dayAxis, GRID_STROKE } from "./V2BackOfficeCharts";

/* Bars of tracked time and captures. One series in the first chart color, and
   no animation on any mark: a figure is read, not watched arriving. */

const hoursConfig = { hours: { label: "Tracked", color: "var(--df-chart-1)" } } satisfies ChartConfig;
const capturesConfig = { count: { label: "Captures", color: "var(--df-chart-1)" } } satisfies ChartConfig;

/** Daily (or weekly) hours as bars; the axis is in hours and the tooltip reads "12.0 h". */
export function HoursPerDayChart({ chart }: { chart: HoursChart }) {
  return (
    <ChartContainer config={hoursConfig} className="df-chart" data-testid="v2-analytics-hours-chart">
      <BarChart data={chart.points} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
        {dayAxis()}
        <YAxis
          tickFormatter={(value: number) => `${value} h`}
          tickLine={false}
          axisLine={false}
          width={44}
          domain={[0, "auto"]}
        />
        <ChartTooltip
          cursor={BAR_CURSOR}
          content={
            <ChartTooltipContent
              className="df-chart-tooltip"
              hideIndicator
              formatter={(_value, _name, item) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">Tracked</span>
                  <span className="font-medium tabular-nums">{(item.payload as HoursPoint).tracked}</span>
                </span>
              )}
            />
          }
        />
        <Bar
          dataKey="hours"
          fill="var(--color-hours)"
          radius={[4, 4, 0, 0]}
          maxBarSize={28}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

/** Captures by hour of the day, 00:00 to 23:00, with the same points as a table behind a toggle. */
export function CapturesByHour({
  hourly,
}: {
  hourly: { empty: boolean; points: HourPoint[]; table: StatsChartTable };
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div data-testid="v2-analytics-hourly">
      <div className="df-analytics-subhead">
        <p className="df-analytics-subhead-title">By hour</p>
        {hourly.empty ? null : (
          <Toggle
            pressed={asTable}
            onPressedChange={setAsTable}
            className="df-chart-toggle"
            aria-label="Show captures by hour as a table"
            data-testid="v2-analytics-hourly-table-toggle"
          >
            <Table2 width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
            Table
          </Toggle>
        )}
      </div>
      {hourly.empty ? (
        <V2CompactEmpty>No captures in this range</V2CompactEmpty>
      ) : (
        <div className="df-chart-body">
          {asTable ? (
            <ChartTable table={hourly.table} testId="v2-analytics-hourly-table" />
          ) : (
            <ChartContainer config={capturesConfig} className="df-chart df-chart-small" data-testid="v2-analytics-hourly-chart">
              <BarChart data={hourly.points} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                <YAxis allowDecimals={false} tickFormatter={formatCount} tickLine={false} axisLine={false} width={40} domain={[0, "auto"]} />
                <ChartTooltip cursor={BAR_CURSOR} content={<ChartTooltipContent className="df-chart-tooltip" hideIndicator />} />
                <Bar
                  dataKey="count"
                  fill="var(--color-count)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          )}
        </div>
      )}
    </div>
  );
}
