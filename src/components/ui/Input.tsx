import type { InputHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

export function Input({
  icon: Icon,
  invalid = false,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  icon?: LucideIcon;
  invalid?: boolean;
}) {
  // className 作用于 <input> 本体；宽度由调用方指定（如 w-64 / w-full）
  const input = (
    <input
      aria-invalid={invalid || undefined}
      className={`input ${Icon ? "pl-9" : ""} ${
        invalid ? "border-red-500/50 focus:border-red-400/70" : ""
      } ${className}`}
      {...props}
    />
  );
  if (!Icon) return input;
  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500"
        aria-hidden="true"
      />
      {input}
    </div>
  );
}
