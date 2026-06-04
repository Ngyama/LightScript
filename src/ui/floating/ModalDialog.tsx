import { useEffect, useRef } from "react";

interface ModalDialogProps {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onClose: () => void;
}

export function ModalDialog({
  title,
  message,
  confirmText = "OK",
  cancelText,
  variant = "default",
  onConfirm,
  onClose,
}: ModalDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter") {
        event.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onConfirm, onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="modal-dialog-title" className="modal-dialog-title">
          {title}
        </h2>
        {message && <p className="modal-dialog-message">{message}</p>}
        <div className="modal-dialog-actions">
          {cancelText && (
            <button type="button" className="modal-dialog-secondary" onClick={onClose}>
              {cancelText}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className={`modal-dialog-primary${variant === "danger" ? " is-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
