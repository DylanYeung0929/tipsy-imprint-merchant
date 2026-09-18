export function SimpleBarChart({
  data,
}: {
  data: { label: string; value: number; max?: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-xs text-fg-muted">
        暂无数据
      </div>
    );
  }
  const max = Math.max(1, ...data.map((d) => d.max ?? d.value));
  const barAreaPx = 112;
  return (
    <div className="flex items-end gap-2 border-b border-white/10 px-2 pt-1">
      {data.map((d, i) => (
        // label 可能重复（酒单未加载时的占位名），索引保证 key 唯一，否则 React 残留旧柱
        <div key={`${i}-${d.label}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span className="text-xs tabular-nums text-stone-500">
            {d.value}
          </span>
          <div
            className="w-full max-w-12 rounded-t bg-amber-400/70"
            style={{ height: `${Math.max(4, (d.value / max) * barAreaPx)}px` }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="break-words text-center text-[10px] leading-tight text-stone-500">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}
