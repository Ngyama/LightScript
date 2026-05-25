import type { LucideIcon } from "lucide-react";

interface FloatingActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}

export function FloatingActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: FloatingActionButtonProps) {
  return (
    <button
      type="button"
      className="floating-action-button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon size={16} strokeWidth={1.6} className="floating-action-icon" />
      <span className="floating-action-label">{label}</span>
    </button>
  );
}
