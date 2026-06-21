import { useLayoutEffect, useRef } from "react";
import { useEditorStore } from "../../state/editorStore";
import type { Scene } from "../../domain/model";

interface SceneOutlineProps {
  scene: Scene;
}

export function SceneOutline({ scene }: SceneOutlineProps) {
  const updateSceneOutline = useEditorStore((state) => state.updateSceneOutline);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [scene.outline, scene.id]);

  return (
    <section className="scene-outline" aria-label="场景大纲">
      <textarea
        ref={textareaRef}
        className="scene-outline-input"
        value={scene.outline}
        placeholder="场景大纲…"
        rows={2}
        onChange={(event) => updateSceneOutline(scene.id, event.target.value)}
      />
    </section>
  );
}
