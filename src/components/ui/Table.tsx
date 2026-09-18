import type { ReactNode } from "react";
import { Skeleton } from "./Skeleton";

export type TableColumn = {
  key: string;
  label: ReactNode;
  className?: string;
};

export function Table({
  columns,
  minWidth,
  stickyFirstCol = false,
  caption,
  loading = false,
  isEmpty = false,
  emptyRow,
  emptyText = "暂无数据",
  children,
}: {
  columns: TableColumn[];
  /** 小于该宽度时容器内横向滚动 */
  minWidth?: number;
  stickyFirstCol?: boolean;
  /** 仅屏幕阅读器可见的表格说明 */
  caption: string;
  loading?: boolean;
  isEmpty?: boolean;
  emptyRow?: ReactNode;
  emptyText?: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className={`table-base ${stickyFirstCol ? "table-sticky" : ""}`}
        style={minWidth ? { minWidth } : undefined}
      >
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.className}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            // 骨架只渲染 1 行，空态行仅在 isEmpty 时出现（E2E 依赖 tbody tr 计数）
            <tr>
              <td colSpan={columns.length} className="border-0 py-4">
                <Skeleton className="h-5 w-full" />
              </td>
            </tr>
          ) : isEmpty ? (
            emptyRow ?? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="border-0 py-10 text-center text-sm text-stone-500"
                >
                  {emptyText}
                </td>
              </tr>
            )
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}
