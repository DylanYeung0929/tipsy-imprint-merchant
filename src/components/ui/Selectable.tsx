import type { ButtonHTMLAttributes } from "react";

/** 统一选中态的可点选项（chip 横滑条 / tile 卡片），保持 <button> 语义与 disabled 属性 */
export function Selectable({
  selected = false,
  variant = "chip",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
  variant?: "chip" | "tile";
}) {
  const shape =
    variant === "chip"
      ? "rounded-full border px-3 py-1.5 text-xs"
      : "rounded-xl border p-3 text-left text-sm";
  const state = selected
    ? "border-amber-400/45 bg-amber-500/10 text-amber-200"
    : "border-white/10 text-stone-400 hover:border-white/25 hover:text-stone-200";
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${shape} ${state} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
