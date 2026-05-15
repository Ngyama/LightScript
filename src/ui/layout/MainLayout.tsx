import type { ReactNode } from "react";

interface MainLayoutProps {
  sidebar: ReactNode;
  content: ReactNode;
}

export function MainLayout({ sidebar, content }: MainLayoutProps) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">{sidebar}</aside>
      <main className="app-content">{content}</main>
    </div>
  );
}
