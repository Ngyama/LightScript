import { useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { downloadAndInstallUpdate, formatUpdateError } from "../../updates/appUpdater";

interface UpdateAvailableDialogProps {
  update: Update;
  onClose: () => void;
}

export function UpdateAvailableDialog({ update, onClose }: UpdateAvailableDialogProps) {
  const [installing, setInstalling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const installRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!installing) {
      installRef.current?.focus();
    }
  }, [installing]);

  useEffect(() => {
    if (installing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [installing, onClose]);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    setPercent(0);
    try {
      await downloadAndInstallUpdate(update, setPercent);
    } catch (err) {
      setError(formatUpdateError(err));
      setInstalling(false);
      setPercent(null);
    }
  };

  const notes = update.body?.trim();

  return (
    <div className="modal-overlay" onMouseDown={installing ? undefined : onClose}>
      <div
        className="modal-dialog update-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="update-dialog-title" className="modal-dialog-title">
          发现新版本
        </h2>
        <p className="modal-dialog-message">
          LightScript <strong>v{update.version}</strong> 已发布
          {update.date ? `（${new Date(update.date).toLocaleDateString()}）` : ""}。
          可在应用内下载并安装。
        </p>
        {notes ? <pre className="update-dialog-notes">{notes}</pre> : null}
        {installing ? (
          <p className="update-dialog-progress" aria-live="polite">
            {percent === null ? "正在下载…" : `正在下载… ${percent}%`}
            {percent === 100 ? " 即将重启。" : ""}
          </p>
        ) : null}
        {error ? <p className="update-dialog-error">{error}</p> : null}
        <div className="modal-dialog-actions">
          <button
            type="button"
            className="modal-dialog-secondary"
            onClick={onClose}
            disabled={installing}
          >
            稍后
          </button>
          <button
            ref={installRef}
            type="button"
            className="modal-dialog-primary"
            onClick={() => void handleInstall()}
            disabled={installing}
          >
            {installing ? "安装中…" : "下载并安装"}
          </button>
        </div>
      </div>
    </div>
  );
}
