import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Card({
  padded = "md",
  className = "",
  children,
}: {
  padded?: "none" | "sm" | "md";
  className?: string;
  children: ReactNode;
}) {
  const pad = padded === "none" ? "" : padded === "sm" ? "p-4" : "p-5";
  return <div className={`card ${pad} ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  icon: Icon,
  meta,
  actions,
  className = "",
}: {
  title: ReactNode;
  icon?: LucideIcon;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        {Icon && <Icon className="size-4 shrink-0 text-amber-400" aria-hidden="true" />}
        <h2 className="truncate text-sm font-medium text-stone-300">{title}</h2>
        {meta && <span className="shrink-0 text-xs text-stone-500">{meta}</span>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
