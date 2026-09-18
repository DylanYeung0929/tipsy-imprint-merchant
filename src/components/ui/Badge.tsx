import type { ReactNode } from "react";

const TONE = {
  gold: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  sky: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  neutral: "border-white/15 bg-white/5 text-stone-400",
} as const;

const SIZE = {
  sm: "px-2 py-0.5 text-2xs",
  md: "px-2.5 py-1 text-xs",
} as const;

export type BadgeTone = keyof typeof TONE;

export function Badge({
  tone = "neutral",
  size = "sm",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  size?: keyof typeof SIZE;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${TONE[tone]} ${SIZE[size]} ${className}`}
    >
      {children}
    </span>
  );
}
