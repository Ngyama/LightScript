import { useEffect, useMemo, useState } from "react";
import type { Scene } from "../../domain/model";
import { mergeImportedBlocks, parseMarkdownImport } from "../../domain/blockImport";
import { useEditorStore } from "../../state/editorStore";
import { pickImportMarkdownPath, readTextFile } from "../../storage/projectStorage";

type ImportMode = "replace" | "append";

interface ImportDialogProps {
  scene: Scene;
  onClose: () => void;
  onComplete: (message: string) => void;
  onError: (message: string) => void;
}

export function ImportDialog({ scene, onClose, onComplete, onError }: ImportDialogProps) {
  const setSceneBlocks = useEditorStore((state) => state.setSceneBlocks);
  const renameScene = useEditorStore((state) => state.renameScene);

  const [mode, setMode] = useState<ImportMode>("append");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [sceneTitleFromFile, setSceneTitleFromFile] = useState<string | null>(null);
  const [applySceneTitle, setApplySceneTitle] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const canImport = useMemo(
    () => Boolean(filePath) && previewCount !== null && previewCount > 0,
    [filePath, previewCount],
  );

  const handlePickFile = async () => {
    try {
      const selected = await pickImportMarkdownPath();
      if (!selected) {
        return;
      }
      const content = await readTextFile(selected);
      const parsed = parseMarkdownImport(content);
      setFilePath(selected);
      setPreviewCount(parsed.blocks.length);
      setSceneTitleFromFile(parsed.sceneTitle ?? null);
      setApplySceneTitle(Boolean(parsed.sceneTitle && parsed.sceneTitle !== scene.title));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to read markdown file.");
    }
  };

  const handleImport = async () => {
    if (!filePath || !previewCount) {
      return;
    }
    setBusy(true);
    try {
      const content = await readTextFile(filePath);
      const parsed = parseMarkdownImport(content);
      if (parsed.blocks.length === 0) {
        onError("No importable lines were found in this file.");
        return;
      }

      const nextBlocks = mergeImportedBlocks(scene.blocks, parsed.blocks, mode);
      setSceneBlocks(scene.id, nextBlocks);

      if (applySceneTitle && parsed.sceneTitle) {
        renameScene(scene.id, parsed.sceneTitle);
      }

      onComplete(
        `Imported ${parsed.blocks.length} block${parsed.blocks.length === 1 ? "" : "s"} (${mode === "replace" ? "replaced" : "appended"})`,
      );
      onClose();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-dialog-overlay" onMouseDown={busy ? undefined : onClose}>
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="import-dialog-title" className="export-dialog-title">
          Import Markdown
        </h2>
        <p className="export-dialog-subtitle">
          按行导入：带「」或 <code>&gt;</code> / <code>**角色**:</code> 的行识别为台词（不绑定角色），其余为旁白。
        </p>

        <div className="export-dialog-section">
          <div className="export-dialog-label">导入方式</div>
          <div className="export-scope-options">
            <label className="export-scope-option">
              <input
                type="radio"
                name="import-mode"
                value="append"
                checked={mode === "append"}
                onChange={() => setMode("append")}
                disabled={busy}
              />
              追加到当前 Scene
            </label>
            <label className="export-scope-option">
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
                disabled={busy}
              />
              替换当前 Scene 全部 blocks
            </label>
          </div>
        </div>

        <div className="export-dialog-section">
          <div className="export-dialog-label">Markdown 文件</div>
          <div className="export-path-row">
            <input
              type="text"
              className="export-path-input"
              readOnly
              value={filePath ?? ""}
              placeholder="点击「选择…」"
              title={filePath ?? ""}
            />
            <button
              type="button"
              className="export-dialog-secondary"
              onClick={() => {
                void handlePickFile();
              }}
              disabled={busy}
            >
              选择…
            </button>
          </div>
          {previewCount !== null && (
            <p className="export-dialog-subtitle">
              预览：{previewCount} 个 block
              {sceneTitleFromFile ? ` · 标题「${sceneTitleFromFile}」` : ""}
            </p>
          )}
        </div>

        {sceneTitleFromFile && (
          <div className="export-dialog-section">
            <label className="batch-export-scene-option">
              <input
                type="checkbox"
                checked={applySceneTitle}
                onChange={(event) => setApplySceneTitle(event.target.checked)}
                disabled={busy}
              />
              <span>将 Scene 标题更新为 Markdown 中的 # 标题</span>
            </label>
          </div>
        )}

        <div className="export-dialog-actions">
          <button type="button" className="export-dialog-secondary" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="export-dialog-primary"
            onClick={() => {
              void handleImport();
            }}
            disabled={busy || !canImport}
          >
            导入
          </button>
        </div>
      </div>
    </div>
  );
}
