export function MatchBar({ value, label = "设计初衷匹配度" }: { value: number; label?: string }) {
  const color =
    value >= 75 ? "bg-emerald-400" : value >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="tabular-nums text-sm text-stone-300">{value}%</span>
    </div>
  );
}
