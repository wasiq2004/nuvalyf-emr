"use client";

// Bar charts in the design kit's style. Colours come from the panel accent
// (CSS variables), so a chart looks native in every panel and theme.
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const SERIES_COLOURS = ["var(--accent-solid)", "var(--color-amber-500)", "var(--color-emerald-500)", "var(--color-rose-500)"];

export function BarChartPanel({
  data,
  xKey,
  bars,
  height = 260,
  stacked = false,
  valuePrefix = "",
}: {
  /** null = no bar (e.g. a hidden small count), not zero. */
  data: Record<string, string | number | null>[];
  xKey: string;
  bars: { key: string; label: string }[];
  height?: number;
  stacked?: boolean;
  valuePrefix?: string;
}) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-zinc-500">No data for this period.</p>;
  }
  return (
    <div style={{ height }} className="w-full text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fill: "currentColor", opacity: 0.6 }} minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "currentColor", opacity: 0.6 }} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "currentColor", opacity: 0.05 }}
            contentStyle={{ borderRadius: 12, border: "1px solid rgb(228 228 231)", fontSize: 12 }}
            formatter={(value) => (value === null || value === undefined ? "hidden" : `${valuePrefix}${typeof value === "number" ? value.toLocaleString() : value}`)}
          />
          {bars.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
          {bars.map((bar, i) => (
            <Bar
              key={bar.key}
              dataKey={bar.key}
              name={bar.label}
              stackId={stacked ? "stack" : undefined}
              fill={SERIES_COLOURS[i % SERIES_COLOURS.length]}
              radius={stacked && i < bars.length - 1 ? 0 : [6, 6, 0, 0]}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
