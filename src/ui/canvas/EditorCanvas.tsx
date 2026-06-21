import { useEditorStore, useSelectedScene } from "../../state/editorStore";
import { SceneEditor } from "../editor/SceneEditor";
import { GlobalCharacterBar } from "../characters/GlobalCharacterBar";
import { CharacterBar } from "./CharacterBar";
import { SceneTitle } from "./SceneTitle";

export function EditorCanvas() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const scene = useSelectedScene();

  const fallbackTitle = (() => {
    if (!selection.scriptId) return "Select a Scene to start writing";
    if (!selection.sceneId) {
      const script = project.scripts.find((entry) => entry.id === selection.scriptId);
      return script ? `${script.title} · select a Scene` : "Select a Scene";
    }
    return "Select a Scene";
  })();

  return (
    <div className="editor-canvas">
      <div className="editor-inner">
        <GlobalCharacterBar />
        <SceneTitle title={scene ? scene.title : null} fallback={fallbackTitle} />
        {scene && <CharacterBar scene={scene} />}
        {scene ? (
          <SceneEditor />
        ) : (
          <p className="editor-empty-hint">使用左侧轨道导航选择一个 Scene 开始写作。</p>
        )}
      </div>
    </div>
  );
}
