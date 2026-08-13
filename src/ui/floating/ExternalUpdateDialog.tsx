import { useEffect, useRef } from "react";

type ExternalUpdateDialogProps = {
  onUseSynced: () => void;
  onKeepThis: () => void;
  onSaveBoth: () => void;
};

/**
 * Writer-facing conflict resolution when disk changed outside the app
 * (e.g. Google Drive synced another device's copy).
 */
export function ExternalUpdateDialog({
  onUseSynced,
  onKeepThis,
  onSaveBoth,
}: ExternalUpdateDialogProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primaryRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.stopPropagation()}>
      <div
        className="modal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="external-update-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="external-update-title" className="modal-dialog-title">
          这个作品已在另一台设备上修改
        </h2>
        <p className="modal-dialog-message">
          磁盘上出现了更新的副本（例如通过 Google Drive 同步）。请谨慎选择——此对话框里的覆盖操作无法撤销。
        </p>
        <div className="modal-dialog-actions modal-dialog-actions--stack">
          <button
            ref={primaryRef}
            type="button"
            className="modal-dialog-primary"
            onClick={onUseSynced}
          >
            使用同步过来的版本
          </button>
          <button type="button" className="modal-dialog-secondary" onClick={onKeepThis}>
            保留我正在编辑的版本
          </button>
          <button type="button" className="modal-dialog-secondary" onClick={onSaveBoth}>
            两个都保留
          </button>
        </div>
        <p className="modal-dialog-hint">
          <strong>使用同步过来的版本</strong>
          ：放弃当前内存里的未保存修改。
          <strong> 保留我正在编辑的版本</strong>
          ：下次保存会覆盖磁盘上的同步文件。
          <strong> 两个都保留</strong>
          ：先把同步文件另存一份，并继续保留你正在编辑的内容。
        </p>
      </div>
    </div>
  );
}
