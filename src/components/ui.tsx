import type { LucideIcon } from "lucide-react";

export function PageHeader({ en, title, desc }: { en: string; title: string; desc?: string }) {
  return (
    <header className="mb-8">
      <p className="display-en text-xs text-amber-400">{en}</p>
      <h1 className="mt-1 text-3xl font-semibold text-stone-100">{title}</h1>
      {desc && <p className="mt-2 max-w-2xl text-sm text-stone-500">{desc}</p>}
    </header>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-amber-400" aria-hidden="true" />
        <p className="text-sm text-stone-500">{label}</p>
      </div>
      <p className="mt-4 text-4xl font-semibold tabular-nums tracking-[.04em] text-stone-50">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-stone-500">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-stone-600">{hint}</p>}
    </div>
  );
}

export function MatchBar({ value }: { value: number }) {
  const color =
    value >= 75 ? "bg-emerald-400" : value >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="tabular-nums text-sm text-stone-300">{value}%</span>
    </div>
  );
}

export function SimpleBarChart({
  data,
}: {
  data: { label: string; value: number; max?: number }[];
}) {
  const max = Math.max(...data.map((d) => d.max ?? d.value));
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

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg bg-[#161311] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-500 hover:text-stone-200"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
