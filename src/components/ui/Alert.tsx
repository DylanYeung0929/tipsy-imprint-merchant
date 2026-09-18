import type { ElementType, ReactNode } from "react";

const TONE = {
  danger: "border-red-500/30 bg-red-500/10 text-red-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
} as const;

export type AlertTone = keyof typeof TONE;

/** 错误/提示条。根元素默认 <p>（E2E 契约依赖），需要块级容器时传 as="div"。 */
export function Alert({
  tone = "danger",
  as: Tag = "p",
  className = "",
  children,
}: {
  tone?: AlertTone;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag role="alert" className={`rounded-lg border px-3 py-2 text-sm ${TONE[tone]} ${className}`}>
      {children}
    </Tag>
  );
}
