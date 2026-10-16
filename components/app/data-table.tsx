// Simple, consistent table for list screens. Server-component friendly.
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  /** Hide on small screens. */
  hideOnMobile?: boolean;
  align?: "left" | "right";
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0 && empty) return <div className="p-6 lg:p-8">{empty}</div>;

  return (
    // Use inside <Panel flush> so rows run edge to edge.
    <div className="overflow-x-auto">
      <table className="w-full min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  "px-6 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500 first:pl-6 lg:first:pl-8 last:pr-6 lg:last:pr-8",
                  column.hideOnMobile && "hidden md:table-cell",
                  column.align === "right" && "text-right",
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-6 py-4 align-middle text-zinc-700 first:pl-6 lg:first:pl-8 last:pr-6 lg:last:pr-8 dark:text-zinc-300",
                    column.hideOnMobile && "hidden md:table-cell",
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
