import { useEditorStore } from "../../state/editorStore";
import type { Scene } from "../../domain/model";
import { SceneTitle } from "./SceneTitle";

interface SceneHeaderProps {
  scene: Scene | null;
  fallback: string;
}

export function SceneHeader({ scene, fallback }: SceneHeaderProps) {
  const updateSceneLocation = useEditorStore((state) => state.updateSceneLocation);

  if (!scene) {
    return <SceneTitle title={null} fallback={fallback} />;
  }

  return (
    <header className="scene-header">
      <SceneTitle title={scene.title} />
      <input
        className="scene-location-input"
        type="text"
        value={scene.location}
        placeholder="发生地点…"
        aria-label="发生地点"
        onChange={(event) => updateSceneLocation(scene.id, event.target.value)}
      />
    </header>
  );
}
