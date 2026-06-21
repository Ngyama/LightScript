import { Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface TitleBarAction {
  label: string;
  onClick: () => void;
}

interface TitleBarProps {
  title: string;
  actions?: TitleBarAction[];
}

export function TitleBar({ title, actions }: TitleBarProps) {
  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const handleClose = () => {
    void getCurrentWindow().close();
  };

  return (
    <div className="title-bar">
      <div className="title-bar-left">
        <div className="title-bar-drag" data-tauri-drag-region>
          <span className="title-bar-label">{title}</span>
        </div>
        {actions && actions.length > 0 && (
          <nav className="title-bar-actions" aria-label="Editor actions">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="title-bar-pill"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className="title-bar-controls">
        <button
          type="button"
          className="title-bar-button"
          onClick={handleMinimize}
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={14} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="title-bar-button title-bar-button-close"
          onClick={handleClose}
          aria-label="Close"
          title="Close"
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
