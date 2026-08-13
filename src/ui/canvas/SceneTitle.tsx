interface SceneTitleProps {
  title: string | null;
  fallback?: string;
}

export function SceneTitle({ title, fallback = "请选择 Scene" }: SceneTitleProps) {
  if (!title) {
    return <h1 className="scene-title scene-title-empty">{fallback}</h1>;
  }
  return <h1 className="scene-title">{title}</h1>;
}
