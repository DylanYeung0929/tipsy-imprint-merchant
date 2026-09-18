import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

const SIZE = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
} as const;

export type ModalSize = keyof typeof SIZE;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 引用计数：ConfirmDialog 叠在 Modal 上时外层关闭不能提前解锁滚动
let scrollLockCount = 0;

function useScrollLock() {
  useEffect(() => {
    if (scrollLockCount === 0) document.body.style.overflow = "hidden";
    scrollLockCount++;
    return () => {
      scrollLockCount--;
      if (scrollLockCount === 0) document.body.style.overflow = "";
    };
  }, []);
}

export function Modal({
  title,
  onClose,
  size = "md",
  preventClose = false,
  className = "",
  initialFocusRef,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  size?: ModalSize;
  /** 禁用 Esc 与点击遮罩关闭（✕ / 取消按钮仍可用），用于处理中的流程 */
  preventClose?: boolean;
  className?: string;
  /** 挂载时优先聚焦的元素（如确认弹窗的「取消」）；缺省聚焦面板本身 */
  initialFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  // 监听与关闭动作读取 ref 中的最新回调：effect 仅在挂载时执行一次，
  // 否则父级每次重渲染（如弹窗内输入触发的 setState）都会重跑 effect、抢走输入焦点
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const preventCloseRef = useRef(preventClose);
  preventCloseRef.current = preventClose;

  useScrollLock();

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    (initialFocusRef?.current ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!preventCloseRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [initialFocusRef]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={preventClose ? undefined : () => onCloseRef.current()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={`card max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-t-panel bg-ink-2 p-6 outline-none max-sm:rounded-b-none sm:max-h-[85vh] sm:rounded-xl ${SIZE[size]} ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-100">{title}</h2>
          <button onClick={() => onCloseRef.current()} className="icon-btn" aria-label="关闭">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
