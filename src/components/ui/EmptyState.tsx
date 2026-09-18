import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "md",
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-center ${
        size === "sm" ? "py-8" : "py-12"
      }`}
    >
      {Icon && <Icon className="size-8 text-fg-faint" aria-hidden="true" />}
      <div className="space-y-1.5">
        <p className="text-sm text-stone-400">{title}</p>
        {description && <p className="mx-auto max-w-md text-xs text-stone-500">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
