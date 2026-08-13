import { Minus, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleBarSearch } from "./TitleBarSearch";

export interface TitleBarAction {
  label: string;
  onClick: () => void;
}

interface TitleBarProps {
  title: string;
  actions?: TitleBarAction[];
  showSearch?: boolean;
}

function TitleBarDragRegion({ className = "" }: { className?: string }) {
  return (
    <div
      className={`title-bar-drag title-bar-drag--flex ${className}`.trim()}
      data-tauri-drag-region
      aria-hidden="true"
    />
  );
}

export function TitleBar({ title, actions, showSearch = false }: TitleBarProps) {
  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const handleClose = () => {
    void getCurrentWindow().close();
  };

  return (
    <div className="title-bar">
      <div className="title-bar-drag title-bar-drag--title" data-tauri-drag-region>
        <span className="title-bar-label">{title}</span>
      </div>
      {actions && actions.length > 0 && (
        <nav className="title-bar-actions" aria-label="编辑操作">
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
      <TitleBarDragRegion />
      {showSearch && (
        <div className="title-bar-search-slot">
          <TitleBarSearch />
        </div>
      )}
      {showSearch && <TitleBarDragRegion />}
      <div className="title-bar-controls">
        <button
          type="button"
          className="title-bar-button"
          onClick={handleMinimize}
          aria-label="最小化"
          title="最小化"
        >
          <Minus size={14} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="title-bar-button title-bar-button-close"
          onClick={handleClose}
          aria-label="关闭"
          title="关闭"
        >
          <X size={14} strokeWidth={1.6} />
        </button>
      </div>
    </div>
  );
}
