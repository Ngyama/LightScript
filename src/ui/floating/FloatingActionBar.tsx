import type { ReactNode } from "react";

interface FloatingActionBarProps {
  children: ReactNode;
}

export function FloatingActionBar({ children }: FloatingActionBarProps) {
  return <div className="floating-actions">{children}</div>;
}
