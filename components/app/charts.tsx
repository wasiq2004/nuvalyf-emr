"use client";

// Bar charts in the design kit's style. Colours come from the panel accent
// (CSS variables), so a chart looks native in every panel and theme.
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

/** One value over time, with its reference range as a band behind the line. */
export function TrendChart({ data, label, unit, low, high, height = 200 }: { data: { date: string; value: number }[]; label: string; unit: string | null; low: number | null; high: number | null; height?: number }) {
  const values = [...data.map((d) => d.value), ...(low !== null ? [low] : []), ...(high !== null ? [high] : [])];
  const spread = Math.max(...values) - Math.min(...values) || Math.abs(values[0]) || 1;
  const domain: [number, number] = [Math.min(...values) - spread * 0.1, Math.max(...values) + spread * 0.1];
  return (
    <div style={{ height }} className="w-full text-xs">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
          {low !== null && high !== null && <ReferenceArea y1={low} y2={high} fill="var(--color-emerald-500)" fillOpacity={0.1} stroke="none" />}
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "currentColor", opacity: 0.6 }} minTickGap={24} />
          <YAxis domain={domain} tickLine={false} axisLine={false} tick={{ fill: "currentColor", opacity: 0.6 }} tickFormatter={(v: number) => String(Math.round(v * 100) / 100)} width={56} />
          <Tooltip
            cursor={{ stroke: "currentColor", strokeOpacity: 0.2 }}
            contentStyle={{ borderRadius: 12, border: "1px solid rgb(228 228 231)", fontSize: 12 }}
            formatter={(value) => [`${value}${unit ? ` ${unit}` : ""}`, label]}
          />
          <Line type="monotone" dataKey="value" name={label} stroke="var(--accent-solid)" strokeWidth={2} dot={{ r: 4, fill: "var(--accent-solid)", strokeWidth: 2, stroke: "var(--background, white)" }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
