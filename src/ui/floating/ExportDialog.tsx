import { useEffect, useMemo, useState } from "react";
import type { Project, Scene } from "../../domain/model";
import { sceneToExportScene, sceneToMarkdown, sceneToPlainText } from "../../domain/model";
import {
  buildBatchExportFileBase,
  joinExportPath,
  listSceneExportItems,
  renderSceneExportContent,
  sceneIdsForScript,
  uniqueExportBaseName,
} from "../../domain/exportScenes";
import {
  EXPORT_FORMATS,
  pickExportDirectory,
  pickExportSavePath,
  writeDocxExport,
  writeTextExport,
  type ExportFormat,
} from "../../storage/projectStorage";

type ExportScope = "current" | "batch";

interface ExportDialogProps {
  project: Project;
  scene: Scene;
  currentScriptId?: string;
  onClose: () => void;
  onComplete: (message: string) => void;
  onError: (message: string) => void;
}

export function ExportDialog({
  project,
  scene,
  currentScriptId,
  onClose,
  onComplete,
  onError,
}: ExportDialogProps) {
  const items = useMemo(() => listSceneExportItems(project), [project]);
  const [scope, setScope] = useState<ExportScope>("current");
  const [format, setFormat] = useState<ExportFormat>("md");
  const [targetPath, setTargetPath] = useState<string | null>(null);
  const [targetDirectory, setTargetDirectory] = useState<string | null>(null);
  const [selectedSceneIds, setSelectedSceneIds] = useState<Set<string>>(() => new Set([scene.id]));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const initialIds = currentScriptId
      ? sceneIdsForScript(project, currentScriptId)
      : [scene.id];
    setSelectedSceneIds(new Set(initialIds));
  }, [project, currentScriptId, scene.id]);

  useEffect(() => {
    setTargetPath(null);
  }, [format, scope]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const selectedCount = useMemo(
    () => items.filter((item) => selectedSceneIds.has(item.scene.id)).length,
    [items, selectedSceneIds],
  );

  const toggleScene = (sceneId: string) => {
    setSelectedSceneIds((current) => {
      const next = new Set(current);
      if (next.has(sceneId)) {
        next.delete(sceneId);
      } else {
        next.add(sceneId);
      }
      return next;
    });
  };

  const selectCurrentScript = () => {
    if (!currentScriptId) return;
    setSelectedSceneIds(new Set(sceneIdsForScript(project, currentScriptId)));
  };

  const selectAll = () => {
    setSelectedSceneIds(new Set(items.map((item) => item.scene.id)));
  };

  const clearSelection = () => {
    setSelectedSceneIds(new Set());
  };

  const handlePickPath = async () => {
    try {
      const picked = await pickExportSavePath(scene.title || "scene", format);
      if (picked) setTargetPath(picked);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to pick path.");
    }
  };

  const handlePickDirectory = async () => {
    try {
      const picked = await pickExportDirectory();
      if (picked) setTargetDirectory(picked);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to pick folder.");
    }
  };

  const handleExportCurrent = async () => {
    if (!targetPath) {
      onError("请先选择保存位置。");
      return;
    }
    setBusy(true);
    try {
      let saved: string;
      if (format === "docx") {
        const exportScene = sceneToExportScene(scene, project);
        saved = await writeDocxExport(targetPath, JSON.stringify(exportScene));
      } else {
        const content =
          format === "md" ? sceneToMarkdown(scene, project) : sceneToPlainText(scene, project);
        saved = await writeTextExport(targetPath, content);
      }
      onComplete(`Exported as .${format} → ${saved}`);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleExportBatch = async () => {
    if (!targetDirectory) {
      onError("请先选择导出文件夹。");
      return;
    }
    if (selectedCount === 0) {
      onError("请至少选择一个 Scene。");
      return;
    }

    const formatInfo = EXPORT_FORMATS.find((entry) => entry.format === format);
    if (!formatInfo) return;

    setBusy(true);
    const usedNames = new Set<string>();
    const selectedItems = items.filter((item) => selectedSceneIds.has(item.scene.id));

    try {
      for (let index = 0; index < selectedItems.length; index += 1) {
        const item = selectedItems[index];
        setProgress(`正在导出 ${index + 1} / ${selectedItems.length}…`);
        const base = uniqueExportBaseName(
          buildBatchExportFileBase(item.scriptTitle, item.scene.title),
          usedNames,
        );
        const path = joinExportPath(targetDirectory, `${base}.${formatInfo.extension}`);
        if (format === "docx") {
          await writeDocxExport(path, renderSceneExportContent(item.scene, project, format));
        } else {
          await writeTextExport(path, renderSceneExportContent(item.scene, project, format));
        }
      }
      onComplete(`已批量导出 ${selectedItems.length} 个 Scene（.${format}）→ ${targetDirectory}`);
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "批量导出失败。");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const handleExport = () => {
    if (scope === "current") {
      void handleExportCurrent();
    } else {
      void handleExportBatch();
    }
  };

  const exportDisabled =
    busy ||
    (scope === "current" ? !targetPath : !targetDirectory || selectedCount === 0);

  const exportLabel =
    scope === "current"
      ? busy
        ? "Exporting…"
        : "Export"
      : busy
        ? progress || "导出中…"
        : `导出 ${selectedCount} 个 Scene`;

  return (
    <div
      className="export-dialog-overlay"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className={`export-dialog${scope === "batch" ? " batch-export-dialog" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="export-dialog-title" className="export-dialog-title">
          Export
        </h2>

        <div className="export-dialog-section">
          <div className="export-dialog-label">范围</div>
          <div className="export-scope-options">
            <label className="export-scope-option">
              <input
                type="radio"
                name="export-scope"
                value="current"
                checked={scope === "current"}
                onChange={() => setScope("current")}
                disabled={busy}
              />
              <span>当前 Scene</span>
            </label>
            <label className="export-scope-option">
              <input
                type="radio"
                name="export-scope"
                value="batch"
                checked={scope === "batch"}
                onChange={() => setScope("batch")}
                disabled={busy}
              />
              <span>多个 Scene</span>
            </label>
          </div>
        </div>

        {scope === "current" ? (
          <p className="export-dialog-subtitle" title={scene.title}>
            {scene.title}
          </p>
        ) : (
          <p className="export-dialog-subtitle">
            已选 {selectedCount} / {items.length} 个 Scene，每个 Scene 导出为单独文件。
          </p>
        )}

        <div className="export-dialog-section">
          <div className="export-dialog-label">格式</div>
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

        {scope === "batch" && (
          <div className="export-dialog-section">
            <div className="batch-export-toolbar">
              <button
                type="button"
                className="export-dialog-secondary batch-export-toolbar-btn"
                onClick={selectAll}
                disabled={busy}
              >
                全选
              </button>
              <button
                type="button"
                className="export-dialog-secondary batch-export-toolbar-btn"
                onClick={selectCurrentScript}
                disabled={busy || !currentScriptId}
              >
                当前 Script
              </button>
              <button
                type="button"
                className="export-dialog-secondary batch-export-toolbar-btn"
                onClick={clearSelection}
                disabled={busy}
              >
                清空
              </button>
            </div>
            <div className="batch-export-scene-list">
              {project.scripts.map((script) => (
                <div key={script.id} className="batch-export-script-group">
                  <div className="batch-export-script-title">{script.title}</div>
                  <ul className="batch-export-scene-options">
                    {script.scenes.map((entry) => (
                      <li key={entry.id}>
                        <label className="batch-export-scene-option">
                          <input
                            type="checkbox"
                            checked={selectedSceneIds.has(entry.id)}
                            onChange={() => toggleScene(entry.id)}
                            disabled={busy}
                          />
                          <span title={entry.title}>{entry.title}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="export-dialog-section">
          <div className="export-dialog-label">
            {scope === "current" ? "保存位置" : "导出文件夹"}
          </div>
          <div className="export-path-row">
            <input
              type="text"
              className="export-path-input"
              readOnly
              value={(scope === "current" ? targetPath : targetDirectory) ?? ""}
              placeholder={scope === "current" ? "点击「选择…」" : "点击「选择文件夹…」"}
              title={(scope === "current" ? targetPath : targetDirectory) ?? ""}
            />
            <button
              type="button"
              className="export-dialog-secondary"
              onClick={scope === "current" ? handlePickPath : handlePickDirectory}
              disabled={busy}
            >
              {scope === "current" ? "选择…" : "选择文件夹…"}
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
            取消
          </button>
          <button
            type="button"
            className="export-dialog-primary"
            onClick={handleExport}
            disabled={exportDisabled}
          >
            {exportLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
