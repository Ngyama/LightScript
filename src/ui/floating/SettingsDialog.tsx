import { useEffect } from "react";

// Keep in sync with src-tauri/tauri.conf.json (productName / version).
const APP_NAME = "LightScript";
const APP_VERSION = "0.1.0";

const FONT_OPTIONS = ["System Default", "Noto Sans JP", "Dancing Script"];
const THEME_OPTIONS = ["Light", "Sepia", "Dark"];

interface SettingsDialogProps {
  onClose: () => void;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
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
            <span className="settings-soon">Coming soon</span>
          </div>
          <select className="settings-select" defaultValue="Light" disabled>
            {THEME_OPTIONS.map((theme) => (
              <option key={theme} value={theme}>
                {theme}
              </option>
            ))}
          </select>
        </div>

        <div className="settings-footer">
          <div className="settings-about">
            <span className="settings-about-name">{APP_NAME}</span>
            <span className="settings-about-version">v{APP_VERSION}</span>
          </div>
          <button type="button" className="export-dialog-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
