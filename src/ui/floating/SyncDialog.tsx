import { useEffect, useState } from "react";
import {
  describeSyncStatus,
  isSyncConflictError,
  syncConflictKind,
  type SyncInspectResult,
} from "../../domain/projectSync";
import {
  inspectProjectSync,
  pullProjectFromCloud,
  pushProjectToCloud,
} from "../../storage/projectStorage";

type SyncDialogProps = {
  projectPath: string;
  projectName: string;
  onClose: () => void;
  onPulled: () => void | Promise<void>;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
};

export function SyncDialog({
  projectPath,
  projectName,
  onClose,
  onPulled,
  onMessage,
  onError,
}: SyncDialogProps) {
  const [inspect, setInspect] = useState<SyncInspectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const refresh = async () => {
    const next = await inspectProjectSync(projectPath);
    setInspect(next);
    setConflict(null);
  };

  useEffect(() => {
    let cancelled = false;
    void inspectProjectSync(projectPath)
      .then((next) => {
        if (!cancelled) {
          setInspect(next);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "无法检查同步状态。");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, onError]);

  const handlePush = async (force: boolean) => {
    setBusy(true);
    try {
      const result = await pushProjectToCloud(projectPath, force);
      onMessage(`已同步到云端（${result.transferred} 个文件）`);
      await refresh();
      if (force) {
        onClose();
      }
    } catch (error) {
      if (isSyncConflictError(error)) {
        setConflict(syncConflictKind(error) ?? "diverged");
      } else {
        onError(error instanceof Error ? error.message : "推送到云端失败。");
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePull = async (force: boolean) => {
    setBusy(true);
    try {
      const result = await pullProjectFromCloud(projectPath, force);
      onMessage(`已从云端拉取（${result.transferred} 个文件）`);
      await onPulled();
      await refresh();
      onClose();
    } catch (error) {
      if (isSyncConflictError(error)) {
        setConflict(syncConflictKind(error) ?? "diverged");
      } else {
        onError(error instanceof Error ? error.message : "从云端拉取失败。");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="sync-dialog-title" className="modal-dialog-title">
          同步「{projectName}」
        </h2>
        <p className="modal-dialog-message">
          本地作品库是正在编辑的地方；云端镜像用于低频备份与多设备接力。快照不会上传。
        </p>
        {inspect ? (
          <p className="modal-dialog-message">
            状态：<strong>{describeSyncStatus(inspect.status)}</strong>
            {!inspect.cloudConfigured && " — 请先在设置中绑定云端镜像文件夹。"}
          </p>
        ) : (
          <p className="modal-dialog-message">正在检查…</p>
        )}

        {conflict && (
          <div className="sync-conflict-box">
            <p>
              本地与云端不一致（{describeSyncStatus(conflict)}）。请选择要以哪边为准：
            </p>
            <div className="modal-dialog-actions modal-dialog-actions--stack">
              <button
                type="button"
                className="modal-dialog-primary"
                disabled={busy}
                onClick={() => {
                  void handlePull(true);
                }}
              >
                使用云端版本（覆盖本地）
              </button>
              <button
                type="button"
                className="modal-dialog-secondary"
                disabled={busy}
                onClick={() => {
                  void handlePush(true);
                }}
              >
                保留本地并覆盖云端
              </button>
              <button
                type="button"
                className="modal-dialog-secondary"
                disabled={busy}
                onClick={() => setConflict(null)}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {!conflict && (
          <div className="modal-dialog-actions modal-dialog-actions--stack">
            <button
              type="button"
              className="modal-dialog-primary"
              disabled={busy || !inspect?.cloudConfigured}
              onClick={() => {
                void handlePush(false);
              }}
            >
              同步到云端
            </button>
            <button
              type="button"
              className="modal-dialog-secondary"
              disabled={busy || !inspect?.cloudConfigured}
              onClick={() => {
                void handlePull(false);
              }}
            >
              从云端拉取
            </button>
            <button type="button" className="modal-dialog-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
