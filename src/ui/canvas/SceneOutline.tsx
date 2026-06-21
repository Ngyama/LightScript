import { useEffect, useLayoutEffect, useRef } from "react";
import { applyTextSelection } from "../../domain/navigation";
import { useEditorStore } from "../../state/editorStore";
import type { Scene } from "../../domain/model";

interface SceneOutlineProps {
  scene: Scene;
}

export function SceneOutline({ scene }: SceneOutlineProps) {
  const updateSceneOutline = useEditorStore((state) => state.updateSceneOutline);
  const navigationTarget = useEditorStore((state) => state.navigationTarget);
  const clearNavigationTarget = useEditorStore((state) => state.clearNavigationTarget);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [scene.outline, scene.id]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.kind !== "outline") return;
    if (navigationTarget.sceneId !== scene.id) return;

    const { matchStart, matchEnd } = navigationTarget;

    const focusTarget = (): boolean => {
      const node = textareaRef.current;
      if (!node) return false;
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.focus();
      applyTextSelection(node, matchStart, matchEnd);
      clearNavigationTarget();
      return true;
    };

    if (focusTarget()) return;

    const frame = window.requestAnimationFrame(() => {
      if (!focusTarget()) {
        window.setTimeout(() => {
          focusTarget();
        }, 0);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationTarget, scene.id, clearNavigationTarget]);

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
