import { useEffect } from "react";

type ConfirmModalProps = {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({ open, message, onConfirm, onCancel }: ConfirmModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      id="confirm-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="w-[min(360px,90vw)] rounded-2xl border border-white/10 bg-ink-800 p-6 text-white shadow-panel">
        <p className="text-sm text-white/90">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-white/30"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-aura-400 px-4 py-2 text-sm font-semibold text-ink-900 hover:bg-aura-500"
            onClick={onConfirm}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
