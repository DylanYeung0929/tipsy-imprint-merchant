import { useRef } from "react";
import type { ReactNode } from "react";
import { Modal } from "./Modal";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (!open) return null;

  return (
    <Modal title={title} size="sm" onClose={onCancel} preventClose={busy} initialFocusRef={cancelRef}>
      {description && <div className="text-sm text-stone-400">{description}</div>}
      <div className="mt-6 flex justify-end gap-3">
        <button ref={cancelRef} className="btn-ghost" onClick={onCancel} disabled={busy}>
          {cancelText}
        </button>
        <button
          className={danger ? "btn-danger" : "btn-primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "处理中…" : confirmText}
        </button>
      </div>
    </Modal>
  );
}
