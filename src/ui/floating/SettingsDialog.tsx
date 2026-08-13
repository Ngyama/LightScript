import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import type { WritingMode } from "../../domain/model";
import { useEditorStore } from "../../state/editorStore";
import {
  getCloudMirrorPath,
  getRepoPath,
  getSyncPrefs,
  pickDirectory,
  setCloudMirrorPath,
  setRepoPath,
  setSyncPrefs,
} from "../../storage/projectStorage";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  type AppTheme,
} from "../../theme/appTheme";
import {
  checkForAppUpdate,
  formatUpdateError,
  getAppVersion,
} from "../../updates/appUpdater";

const APP_NAME = "LightScript";

const FONT_OPTIONS = ["System Default", "Noto Sans JP", "Dancing Script"];

const THEME_OPTIONS: Array<{ value: AppTheme; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];

const WRITING_MODE_OPTIONS: Array<{ value: WritingMode; label: string; hint: string }> = [
  {
    value: "character",
    label: "角色对话",
    hint: "对话段左侧显示发言人，可 Tab 切换角色",
  },
  {
    value: "quote",
    label: "引号体",
    hint: "对话不显示角色；空段 Enter 切换类型，对话自动出现「」",
  },
];

interface SettingsDialogProps {
  onClose: () => void;
  onUpdateAvailable: (update: Update) => void;
  onLibraryPathsChanged?: () => void | Promise<void>;
}

type UpdateCheckState = "idle" | "checking" | "upToDate" | "error";

export function SettingsDialog({
  onClose,
  onUpdateAvailable,
  onLibraryPathsChanged,
}: SettingsDialogProps) {
  const writingMode = useEditorStore((state) => state.project.settings.writingMode);
  const setWritingMode = useEditorStore((state) => state.setWritingMode);
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());
  const [appVersion, setAppVersion] = useState("…");
  const [updateState, setUpdateCheckState] = useState<UpdateCheckState>("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [cloudPath, setCloudPath] = useState("");
  const [autoPushOnLeave, setAutoPushOnLeave] = useState(true);
  const [pathMessage, setPathMessage] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [version, repo, cloud, prefs] = await Promise.all([
        getAppVersion(),
        getRepoPath(),
        getCloudMirrorPath(),
        getSyncPrefs(),
      ]);
      if (cancelled) return;
      setAppVersion(version);
      setLocalPath(repo ?? "");
      setCloudPath(cloud ?? "");
      setAutoPushOnLeave(prefs.autoPushOnLeave);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleThemeChange = (next: AppTheme) => {
    setTheme(next);
    setStoredTheme(next);
    applyTheme(next);
  };

  const handleCheckUpdate = async () => {
    setUpdateCheckState("checking");
    setUpdateMessage(null);
    try {
      const update = await checkForAppUpdate();
      if (update) {
        setUpdateCheckState("idle");
        onUpdateAvailable(update);
        onClose();
        return;
      }
      setUpdateCheckState("upToDate");
      setUpdateMessage("已是最新版本");
    } catch (error) {
      setUpdateCheckState("error");
      setUpdateMessage(formatUpdateError(error));
    }
  };

  const persistLocalPath = async (next: string) => {
    setPathError(null);
    setPathMessage(null);
    try {
      await setRepoPath(next);
      setLocalPath(next);
      setPathMessage("本地作品库已更新");
      await onLibraryPathsChanged?.();
    } catch (error) {
      setPathError(error instanceof Error ? error.message : "无法设置本地作品库");
    }
  };

  const persistCloudPath = async (next: string | null) => {
    setPathError(null);
    setPathMessage(null);
    try {
      await setCloudMirrorPath(next);
      setCloudPath(next ?? "");
      setPathMessage(next ? "云端镜像已更新" : "已清除云端镜像");
      await onLibraryPathsChanged?.();
    } catch (error) {
      setPathError(error instanceof Error ? error.message : "无法设置云端镜像");
    }
  };

  const handleAutoPushToggle = async (checked: boolean) => {
    setAutoPushOnLeave(checked);
    try {
      await setSyncPrefs({ autoPushOnLeave: checked, periodicPushMinutes: 0 });
    } catch (error) {
      setPathError(error instanceof Error ? error.message : "无法保存同步偏好");
    }
  };

  return (
    <div className="export-dialog-overlay" onMouseDown={onClose}>
      <div
        className="export-dialog settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="settings-dialog-title" className="export-dialog-title">
          设置
        </h2>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">本地作品库（必选）</span>
          </div>
          <p className="settings-path" title={localPath}>
            {localPath || "未设置"}
          </p>
          <button
            type="button"
            className="settings-update-button"
            onClick={() => {
              void (async () => {
                const selected = await pickDirectory();
                if (selected) {
                  await persistLocalPath(selected);
                }
              })();
            }}
          >
            更改本地文件夹
          </button>
          <p className="settings-hint">
            请使用本机磁盘上的文件夹。不要把作品库直接建在 Google Drive 里。
          </p>
        </div>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">云端镜像（可选）</span>
          </div>
          <p className="settings-path" title={cloudPath}>
            {cloudPath || "未绑定"}
          </p>
          <div className="settings-button-row">
            <button
              type="button"
              className="settings-update-button"
              onClick={() => {
                void (async () => {
                  const selected = await pickDirectory();
                  if (selected) {
                    await persistCloudPath(selected);
                  }
                })();
              }}
            >
              选择云端文件夹
            </button>
            <button
              type="button"
              className="settings-update-button"
              disabled={!cloudPath}
              onClick={() => {
                void persistCloudPath(null);
              }}
            >
              清除
            </button>
          </div>
          <p className="settings-hint">
            可指向 Google Drive 中的文件夹。写作仍在本地；用「同步」低频推送/拉取。快照不会上传。
          </p>
          <label className="settings-checkbox">
            <input
              type="checkbox"
              checked={autoPushOnLeave}
              onChange={(event) => {
                void handleAutoPushToggle(event.target.checked);
              }}
            />
            离开作品时自动尝试同步到云端
          </label>
          <p className="settings-hint">
            若冲突、离线或目录不可用，离开后会显示错误提示（不会静默当作已同步）。
          </p>
          {pathMessage && <p className="settings-hint">{pathMessage}</p>}
          {pathError && (
            <p className="settings-hint is-error" role="alert">
              {pathError}
            </p>
          )}
        </div>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">写作模式</span>
          </div>
          <select
            className="settings-select"
            value={writingMode}
            onChange={(event) => setWritingMode(event.target.value as WritingMode)}
          >
            {WRITING_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="settings-hint">
            {WRITING_MODE_OPTIONS.find((option) => option.value === writingMode)?.hint}
          </p>
        </div>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">字体</span>
            <span className="settings-soon">即将推出</span>
          </div>
          <select className="settings-select" defaultValue="" disabled>
            <option value="">系统默认</option>
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">主题</span>
          </div>
          <select
            className="settings-select"
            value={theme}
            onChange={(event) => handleThemeChange(event.target.value as AppTheme)}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="settings-hint">深色主题使用偏暖的灰调，不是纯黑。</p>
        </div>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">更新</span>
          </div>
          <button
            type="button"
            className="settings-update-button"
            onClick={() => void handleCheckUpdate()}
            disabled={updateState === "checking"}
          >
            {updateState === "checking" ? "检查中…" : "检查更新"}
          </button>
          {updateMessage ? (
            <p
              className={`settings-hint${updateState === "error" ? " is-error" : ""}`}
              aria-live="polite"
            >
              {updateMessage}
            </p>
          ) : (
            <p className="settings-hint">有新版本时可在应用内下载并安装。</p>
          )}
        </div>

        <div className="settings-footer">
          <div className="settings-about">
            <span className="settings-about-name">{APP_NAME}</span>
            <span className="settings-about-version">v{appVersion}</span>
          </div>
          <button type="button" className="export-dialog-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
