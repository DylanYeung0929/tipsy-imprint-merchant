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
    <div>
      <div className="relative">
        {/* relative 必须在滚动容器上：sr-only 单元格是绝对定位，包含块若在外层会逃逸裁剪、撑宽文档 */}
        <div className="relative overflow-x-auto">
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
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#141211] to-transparent lg:hidden"
          aria-hidden="true"
        />
      </div>
      <p className="mt-2 text-center text-2xs text-fg-faint lg:hidden">← 左右滑动查看完整表格 →</p>
    </div>
  );
}
