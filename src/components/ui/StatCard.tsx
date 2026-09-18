import type { LucideIcon } from "lucide-react";

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
  size = "md",
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  size?: "md" | "sm";
}) {
  // 紧凑指标块（实时体验页等）：label / value 为相邻 <p>，E2E 依赖该 DOM 形状，勿加包裹节点
  if (size === "sm") {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3">
        <p className="text-xs text-fg-faint">{label}</p>
        <p className="mt-1 text-xl font-semibold tabular-nums text-stone-100">
          {value}
          {unit && <span className="ml-1 text-xs font-normal text-stone-500">{unit}</span>}
        </p>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-amber-400" aria-hidden="true" />}
        <p className="text-sm text-stone-500">{label}</p>
      </div>
      <p className="mt-4 text-4xl font-semibold tabular-nums tracking-[.04em] text-stone-50">
        {value}
        {unit && <span className="ml-1 text-base font-normal text-stone-500">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </div>
  );
}
