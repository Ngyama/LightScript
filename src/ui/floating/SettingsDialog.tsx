import { useEffect, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import type { WritingMode } from "../../domain/model";
import { useEditorStore } from "../../state/editorStore";
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
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
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
}

type UpdateCheckState = "idle" | "checking" | "upToDate" | "error";

export function SettingsDialog({ onClose, onUpdateAvailable }: SettingsDialogProps) {
  const writingMode = useEditorStore((state) => state.project.settings.writingMode);
  const setWritingMode = useEditorStore((state) => state.setWritingMode);
  const [theme, setTheme] = useState<AppTheme>(() => getStoredTheme());
  const [appVersion, setAppVersion] = useState("…");
  const [updateState, setUpdateState] = useState<UpdateCheckState>("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAppVersion().then((version) => {
      if (!cancelled) setAppVersion(version);
    });
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
    setUpdateState("checking");
    setUpdateMessage(null);
    try {
      const update = await checkForAppUpdate();
      if (update) {
        setUpdateState("idle");
        onUpdateAvailable(update);
        onClose();
        return;
      }
      setUpdateState("upToDate");
      setUpdateMessage("已是最新版本");
    } catch (error) {
      setUpdateState("error");
      setUpdateMessage(formatUpdateError(error));
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
          Settings
        </h2>

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
            <span className="export-dialog-label">Font</span>
            <span className="settings-soon">Coming soon</span>
          </div>
          <select className="settings-select" defaultValue="" disabled>
            <option value="">System Default</option>
            {FONT_OPTIONS.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </div>

        <div className="export-dialog-section">
          <div className="settings-row-head">
            <span className="export-dialog-label">Theme</span>
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
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
