import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Table2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { formatCount, type DistributionEntry, StatsChartTable, StatsChartsModel } from "./backOffice";

/* Series colors are tokens (--df-chart-*), read through the shadcn ChartConfig. */

const GRID_STROKE = "var(--df-divider-light)";
const CARD_SURFACE = "var(--df-card-white)";
const TOOLTIP_CURSOR = { stroke: "var(--df-divider)", strokeWidth: 1 };
const BAR_CURSOR = { fill: "var(--df-hover)" };
const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 };

const growthConfig = {
  newWorkspaces: { label: "New Workspaces", color: "var(--df-chart-1)" },
  newUsers: { label: "New Users", color: "var(--df-chart-2)" },
} satisfies ChartConfig;

const activeConfig = {
  activeWorkspaces: { label: "Workspaces with tracked time", color: "var(--df-chart-1)" },
} satisfies ChartConfig;

const paymentsConfig = {
  paid: { label: "Paid", color: "var(--df-chart-good)" },
  failed: { label: "Failed", color: "var(--df-chart-critical)" },
} satisfies ChartConfig;

const distributionConfig = {
  count: { label: "Workspaces", color: "var(--df-chart-1)" },
} satisfies ChartConfig;

/** A chart card: a title, a "Table" toggle that swaps the chart for the same points as text. */
export function ChartCard({
  title,
  table,
  testId,
  footer,
  summary,
  children,
}: {
  title: string;
  /** The same points as rows; null while there is nothing to tabulate. */
  table: StatsChartTable | null;
  testId: string;
  footer?: ReactNode;
  /** One muted line under the title, shown in chart and table view alike. */
  summary?: string;
  children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="df-card" data-testid={testId}>
      <div className="df-card-head">
        <div className="df-chart-heading">
          <h2 className="df-card-title">{title}</h2>
          {summary ? (
            <p className="df-chart-summary" data-testid={`${testId}-summary`}>
              {summary}
            </p>
          ) : null}
        </div>
        {table ? (
          <Toggle
            pressed={asTable}
            onPressedChange={setAsTable}
            className="df-chart-toggle"
            aria-label={`Show ${title} as a table`}
            data-testid={`${testId}-table-toggle`}
          >
            <Table2 width={14} height={14} strokeWidth={1.5} aria-hidden="true" />
            Table
          </Toggle>
        ) : null}
      </div>
      <div className="df-chart-body">
        {asTable && table ? <ChartTable table={table} testId={`${testId}-table`} /> : children}
      </div>
      {footer}
    </section>
  );
}

export function ChartTable({ table, testId }: { table: StatsChartTable; testId?: string }) {
  return (
    <div className="df-chart-table-wrap" data-testid={testId}>
      <table className="df-chart-table">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartSkeleton() {
  return <Skeleton className="df-chart-skeleton" data-testid="v2-chart-skeleton" />;
}

function ChartNote({ children }: { children: ReactNode }) {
  return <p className="df-chart-note">{children}</p>;
}

function dayAxis() {
  return <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />;
}

function countAxis(empty: boolean) {
  return (
    <YAxis
      allowDecimals={false}
      tickFormatter={formatCount}
      tickLine={false}
      axisLine={false}
      width={32}
      domain={[0, empty ? 4 : "auto"]}
    />
  );
}

/** New Workspaces and New Users per day: two 2px lines, a dot only on the hovered day. */
export function GrowthChart({ growth }: { growth: NonNullable<StatsChartsModel["growth"]> }) {
  return (
    <>
      <ChartContainer config={growthConfig} className="df-chart" data-testid="v2-chart-growth">
        <LineChart data={growth.points} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          {dayAxis()}
          {countAxis(growth.empty)}
          <ChartTooltip cursor={TOOLTIP_CURSOR} content={<ChartTooltipContent className="df-chart-tooltip" />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />
          {growth.series.map((series) => (
            <Line
              key={series.key}
              dataKey={series.key}
              type="linear"
              stroke={`var(--color-${series.key})`}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, stroke: CARD_SURFACE, strokeWidth: 2 }}
              hide={series.empty}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
      {growth.series
        .filter((series) => series.empty)
        .map((series) => (
          <ChartNote key={series.key}>{series.emptyCopy}</ChartNote>
        ))}
    </>
  );
}

/** One series of daily bars, 4px rounded at the data end and flat on the baseline. */
export function ActiveWorkspacesChart({ active }: { active: NonNullable<StatsChartsModel["activeWorkspaces"]> }) {
  return (
    <>
      <ChartContainer config={activeConfig} className="df-chart df-chart-small" data-testid="v2-chart-active">
        <BarChart data={active.points} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          {dayAxis()}
          {countAxis(active.empty)}
          <ChartTooltip cursor={BAR_CURSOR} content={<ChartTooltipContent className="df-chart-tooltip" />} />
          <Bar
            dataKey="activeWorkspaces"
            fill="var(--color-activeWorkspaces)"
            stroke={CARD_SURFACE}
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            hide={active.empty}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      {active.empty ? <ChartNote>{active.emptyCopy}</ChartNote> : null}
      <p className="df-chart-caption">{active.caption}</p>
    </>
  );
}

type StackedShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  roundTop: boolean;
};

/** A stacked segment: flat on the baseline and on the segment below, rounded only at the stack's top. */
function StackedSegment({ x = 0, y = 0, width = 0, height = 0, fill, roundTop }: StackedShapeProps) {
  if (height <= 0 || width <= 0) return null;
  const r = Math.min(4, width / 2, height);
  const d = roundTop
    ? `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
    : `M${x},${y} H${x + width} V${y + height} H${x} Z`;
  return <path d={d} fill={fill} stroke={CARD_SURFACE} strokeWidth={2} />;
}

type PaymentPoint = NonNullable<StatsChartsModel["payments"]>["points"][number];

/** Paid and Failed per day, stacked. The card writes the totals out: the red is thin on the dark card. */
export function PaymentsChart({ payments }: { payments: NonNullable<StatsChartsModel["payments"]> }) {
  return (
    <>
      <ChartContainer config={paymentsConfig} className="df-chart" data-testid="v2-chart-payments">
        <BarChart data={payments.points} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          {dayAxis()}
          {countAxis(payments.empty)}
          <ChartTooltip cursor={BAR_CURSOR} content={<ChartTooltipContent className="df-chart-tooltip" />} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent />} />
          <Bar
            dataKey="paid"
            stackId="payments"
            fill="var(--color-paid)"
            maxBarSize={28}
            hide={payments.empty}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const shape = props as StackedShapeProps & { payload: PaymentPoint };
              return <StackedSegment {...shape} roundTop={shape.payload.failed === 0} />;
            }}
          />
          <Bar
            dataKey="failed"
            stackId="payments"
            fill="var(--color-failed)"
            maxBarSize={28}
            hide={payments.empty}
            isAnimationActive={false}
            shape={(props: unknown) => <StackedSegment {...(props as StackedShapeProps)} roundTop />}
          />
        </BarChart>
      </ChartContainer>
      {payments.empty ? <ChartNote>{payments.emptyCopy}</ChartNote> : null}
    </>
  );
}

const DISTRIBUTION_ROW = 36;

/** Horizontal bars, one color, the value at the bar's end, largest first. */
export function DistributionChart({ entries, labelWidth = 150 }: { entries: DistributionEntry[]; labelWidth?: number }) {
  return (
    <ChartContainer
      config={distributionConfig}
      className="df-chart df-chart-categories"
      style={{ height: entries.length * DISTRIBUTION_ROW + CHART_MARGIN.top }}
      data-testid="v2-chart-distribution"
    >
      <BarChart layout="vertical" data={entries} margin={{ top: 0, right: 32, left: 0, bottom: 0 }} barCategoryGap={8}>
        <XAxis type="number" hide domain={[0, "dataMax"]} allowDecimals={false} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={labelWidth} />
        <ChartTooltip cursor={BAR_CURSOR} content={<ChartTooltipContent className="df-chart-tooltip" />} />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          stroke={CARD_SURFACE}
          strokeWidth={2}
          radius={[0, 4, 4, 0]}
          barSize={16}
          isAnimationActive={false}
        >
          <LabelList dataKey="count" position="right" offset={8} formatter={(value: number) => formatCount(value)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
