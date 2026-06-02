import { useEffect, useState } from "react";
import type { Scene } from "../../domain/model";
import { sceneToMarkdown, sceneToPlainText } from "../../domain/model";
import {
  EXPORT_FORMATS,
  pickExportSavePath,
  writeDocxExport,
  writeTextExport,
  type ExportFormat,
} from "../../storage/projectStorage";

interface ExportDialogProps {
  scene: Scene;
  onClose: () => void;
  onComplete: (savedPath: string, format: ExportFormat) => void;
  onError: (message: string) => void;
}

export function ExportDialog({ scene, onClose, onComplete, onError }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("md");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Picking a path embeds the extension into the filename, so a previously
  // chosen `.md` path is meaningless after switching to `.docx`.
  useEffect(() => {
    setTargetPath(null);
  }, [format]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const handlePickPath = async () => {
    try {
      const picked = await pickExportSavePath(scene.title || "scene", format);
      if (picked) setTargetPath(picked);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to pick path.");
    }
  };

  const handleExport = async () => {
    if (!targetPath) {
      onError("Please choose a destination first.");
      return;
    }
    setBusy(true);
    try {
      let saved: string;
      if (format === "docx") {
        saved = await writeDocxExport(targetPath, JSON.stringify(scene));
      } else {
        const content =
          format === "md" ? sceneToMarkdown(scene) : sceneToPlainText(scene);
        saved = await writeTextExport(targetPath, content);
      }
      onComplete(saved, format);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="export-dialog-overlay"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="export-dialog-title" className="export-dialog-title">
          Export Scene
        </h2>
        <p className="export-dialog-subtitle" title={scene.title}>
          {scene.title}
        </p>

        <div className="export-dialog-section">
          <div className="export-dialog-label">Format</div>
          <div className="export-format-options">
            {EXPORT_FORMATS.map((info) => (
              <label key={info.format} className="export-format-option">
                <input
                  type="radio"
                  name="export-format"
                  value={info.format}
                  checked={format === info.format}
                  onChange={() => setFormat(info.format)}
                  disabled={busy}
                />
                <span>{info.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="export-dialog-section">
          <div className="export-dialog-label">Destination</div>
          <div className="export-path-row">
            <input
              type="text"
              className="export-path-input"
              readOnly
              value={targetPath ?? ""}
              placeholder="Click ‘Choose…’ to pick a save location"
              title={targetPath ?? ""}
            />
            <button
              type="button"
              className="export-dialog-secondary"
              onClick={handlePickPath}
              disabled={busy}
            >
              Choose…
            </button>
          </div>
        </div>

        <div className="export-dialog-actions">
          <button
            type="button"
            className="export-dialog-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="export-dialog-primary"
            onClick={handleExport}
            disabled={busy || !targetPath}
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
